/*
  Author: Runor Ewhro
  description: compiles reusable numeric rotation scorers while keeping each
               candidate's Echo rows and main-effect state dynamic.
*/
import type { EchoInstance } from '@/domain/entities/runtime'
import { getGameData } from '@/data/gameData'
import { listEchoes } from '@/data/catalog/echoCatalogService'
import { ECHO_STAT_STRIDE } from '@/engine/search/layout/echoLayout'
import { fillPortableInputs } from './portable/cpu'
import { arithmeticSource } from './portable/native'
import { TEAM_INPUT } from './portable/layout'
import type { PortableRotationProgram } from './portable/compiler'
import { compileRotationCandidates, type RotationCandidatePlan } from './candidatePlan'
import { ScalarOp, scalarSpecializer, type ScalarProgram } from './portable/ir'
import { addEchoStat } from '@/engine/search/encode/echoes'

export interface EncodedCandidateBuild {
  echoes: readonly EchoInstance[]
  sets: Uint8Array
  kinds: Uint16Array
  comboIds: Int32Array
  mainIndex: number
  selfMainEchoEffects?: boolean
}
export interface CandidateBuildScorer {
  (stats: Float32Array): number
}
type ScorerFactory = (inputs: Float64Array) => number
interface PreparedCandidateScorer {
  program: PortableRotationProgram
  symbols: Map<string, number>
  evaluate?: ScorerFactory
  compileMs: number
  analysis: ReturnType<typeof scoringInputs>
  mainRelevance?: { specialize: ReturnType<typeof scalarSpecializer>; values: Map<string, boolean> }
}
const candidatesByData = new WeakMap<object, EchoInstance[]>()
const preparedByPlan = new WeakMap<RotationCandidatePlan, PreparedCandidateScorer>()
export interface RotationCandidateCompilation { program: PortableRotationProgram; symbols: Array<[string, number]> }
// only the live input slots are needed for numeric cache keys and updates.
// this is local scorer preparation, not search-space classification.
function scoringInputs(program: ScalarProgram) {
  const inputs = new Set<number>(), columns = new Set<number>()
  for (let pc = 0; pc < program.instructions.length; pc += 5) {
    if (program.instructions[pc] !== ScalarOp.input) continue
    const index = program.instructions[pc + 2]!
    inputs.add(index)
    if (index < TEAM_INPUT.setCounts) columns.add(index % ECHO_STAT_STRIDE)
    else if (index >= TEAM_INPUT.totals && index < TEAM_INPUT.selfMainEchoEffects) columns.add(index - TEAM_INPUT.totals)
  }
  return { inputs: [...inputs], columns: [...columns] }
}
function preparedCompilation(program: PortableRotationProgram, symbols: Map<string, number>, compileMs: number): PreparedCandidateScorer {
  return { program, symbols, compileMs, analysis: scoringInputs(program.scalar) }
}

export function exportRotationCandidateCompilation(plan: RotationCandidatePlan): RotationCandidateCompilation {
  const prepared = prepare(plan)
  return { program: prepared.program, symbols: [...prepared.symbols] }
}
export function adoptRotationCandidateCompilation(plan: RotationCandidatePlan, compiled: RotationCandidateCompilation): void {
  preparedByPlan.set(plan, preparedCompilation(compiled.program, new Map(compiled.symbols), 0))
}

function catalogCandidates(): EchoInstance[] {
  const data = getGameData()
  let candidates = candidatesByData.get(data)
  if (!candidates) {
    candidates = listEchoes().flatMap((echo) => [...new Set([0, ...echo.sets])].map((set): EchoInstance => ({
      uid: `candidate:${echo.id}:${set}`, id: echo.id, set, mainEcho: false,
      mainStats: { primary: { key: 'atkFlat', value: 0 }, secondary: { key: 'hpFlat', value: 0 } }, substats: {},
    })))
    candidatesByData.set(data, candidates)
  }
  return candidates
}

function prepare(plan: RotationCandidatePlan): PreparedCandidateScorer {
  let prepared = preparedByPlan.get(plan)
  if (!prepared) {
    const started = performance.now(), candidates = plan.candidates ?? catalogCandidates()
    const program = compileRotationCandidates(plan, candidates, { dynamicStats: true, selfMainEchoEffects: 'dynamic' })
    prepared = preparedCompilation(program, new Map(candidates.map((echo, row) => [echo.id, program.echoSymbols[row]!])), performance.now() - started)
    preparedByPlan.set(plan, prepared)
  }
  return prepared
}

function factory(prepared: PreparedCandidateScorer): ScorerFactory {
  if (!prepared.evaluate) {
    const code = arithmeticSource({ ...prepared.program.scalar, outputs: prepared.program.scalar.outputs.subarray(0, 1) }, {
      language: 'js', input: index => `inputs[${index}]`,
    })
    prepared.evaluate = new Function('inputs', `"use strict"; ${code.prepare} ${code.evaluate} return ${code.outputs[0]};`) as ScorerFactory
  }
  return prepared.evaluate
}

/** reject a body only when disabling its main leaves exactly the same damage
 * expression for every remaining stat/set input. numeric probes cannot prove
 * this: a set bonus can make an otherwise inactive main effect contribute. */
export function rotationMainEchoCanContribute(plan: RotationCandidatePlan, id: string): boolean {
  const prepared = prepare(plan)
  const relevance = prepared.mainRelevance ??= {
    specialize: scalarSpecializer({ ...prepared.program.scalar, outputs: prepared.program.scalar.outputs.subarray(0, 1) }),
    values: new Map(),
  }
  const known = relevance.values.get(id)
  if (known !== undefined) return known
  const symbol = prepared.symbols.get(id)
  if (symbol === undefined) return false
  const bindings = new Map([[TEAM_INPUT.mainId, 0], [TEAM_INPUT.echoIds, symbol]])
  const neutral = relevance.specialize(bindings)
  bindings.set(TEAM_INPUT.mainId, symbol)
  const contributes = relevance.specialize(bindings) !== neutral
  relevance.values.set(id, contributes)
  return contributes
}

/** metadata belongs to this build frame. only stat values change per call. */
export function prepareRotationBuildScorer(plan: RotationCandidatePlan, build: EncodedCandidateBuild): CandidateBuildScorer {
  const prepared = prepare(plan), inputs = new Float64Array(TEAM_INPUT.count)
  const symbols = Uint32Array.from(build.echoes, (echo) => {
    const symbol = prepared.symbols.get(echo.id)
    if (symbol === undefined) throw new Error(`Unknown rotation candidate Echo ${echo.id}`)
    return symbol
  })
  const rows = Array.from(build.comboIds).filter((row) => row >= 0 && row < build.echoes.length)
  const main = rows.includes(build.mainIndex) ? build.mainIndex : rows[0] ?? -1
  const ordered = main < 0 ? [] : [main, ...rows.filter((row) => row !== main)]
  fillPortableInputs({ stats: new Float32Array(build.echoes.length * ECHO_STAT_STRIDE), sets: build.sets, kinds: build.kinds },
    { ...prepared.program, echoSymbols: symbols }, build.comboIds, main, inputs)
  inputs[TEAM_INPUT.selfMainEchoEffects] = Number(build.selfMainEchoEffects ?? true)
  const updateStats = (stats: Float32Array, destination = inputs, columns = prepared.analysis.columns) => {
    for (const stat of columns) destination[TEAM_INPUT.totals + stat] = 0
    ordered.forEach((row, slot) => {
      for (const stat of columns) {
        const value = stats[row * ECHO_STAT_STRIDE + stat] ?? 0
        destination[slot * ECHO_STAT_STRIDE + stat] = value
        destination[TEAM_INPUT.totals + stat]! += value
      }
    })
  }
  const evaluate = factory(prepared)
  const score: CandidateBuildScorer = stats => { updateStats(stats); return evaluate(inputs) }
  return score
}

/** one reusable numeric frame for a stream of materialized candidates. */
export function prepareRotationCandidateStream(plan: RotationCandidatePlan) {
  const prepared = prepare(plan), inputs = new Float64Array(TEAM_INPUT.count)
  const stats = new Float32Array(5 * ECHO_STAT_STRIDE), sets = new Uint8Array(5), kinds = new Uint16Array(5), symbols = new Uint32Array(5)
  const combo: number[] = [], program = { ...prepared.program, echoSymbols: symbols }
  const evaluate = factory(prepared)
  return {
    load(echoes: readonly (EchoInstance | null)[], selfMainEchoEffects = true, mainEchoEnabled = true) {
      stats.fill(0); sets.fill(0); kinds.fill(0); symbols.fill(0); combo.length = 0
      let main = 0
      for (const echo of echoes) {
        if (!echo) continue
        const row = combo.length
        if (row >= 5) throw new Error('Rotation candidates support at most five Echoes')
        const symbol = prepared.symbols.get(echo.id)
        if (symbol === undefined) throw new Error(`Unknown rotation candidate Echo ${echo.id}`)
        combo.push(row); symbols[row] = symbol; kinds[row] = symbol; sets[row] = echo.set
        if (echo.mainEcho) main = row
        const vector = stats.subarray(row * ECHO_STAT_STRIDE, (row + 1) * ECHO_STAT_STRIDE)
        addEchoStat(vector, echo.mainStats.primary.key, echo.mainStats.primary.value)
        addEchoStat(vector, echo.mainStats.secondary.key, echo.mainStats.secondary.value)
        for (const key in echo.substats) addEchoStat(vector, key, echo.substats[key]!)
      }
      fillPortableInputs({ stats, sets, kinds }, program, combo, combo.length ? main : -1, inputs)
      inputs[TEAM_INPUT.selfMainEchoEffects] = Number(selfMainEchoEffects)
      // contribution checks keep every stat, body and set count fixed while
      // disabling the main's effects and Echo-dependent damage invocations.
      if (!mainEchoEnabled) inputs[TEAM_INPUT.mainId] = 0
    },
    score: () => evaluate(inputs),
    key: () => prepared.analysis.inputs.map((index) => inputs[index]).join(','),
  }
}

export function getRotationCandidateDiagnostics(plan: RotationCandidatePlan | undefined) {
  if (!plan) return null
  const prepared = preparedByPlan.get(plan)
  return prepared ? { backend: 'compiled-cpu' as const, compileMs: prepared.compileMs,
    instructions: prepared.program.scalar.instructions.length / 5, generatedVariants: Number(!!prepared.evaluate) } : null
}
