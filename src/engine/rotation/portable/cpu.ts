/*
  Author: Runor Ewhro
  description: populates portable rotation inputs and evaluates candidate Echo
               combinations through the shared scalar instruction stream.
*/

import type { OptResultStats } from '@/engine/search/score/core'
import { psssCstrs } from '@/engine/search/score/statConstraints'
import { MAIN_FIRST, MAX_ECHO_COST } from '@/engine/search/layout/constants'
import type { ScalarProgram } from './ir'
import { arithmeticSource, mergeRotationScalars, mainInvariantInput } from './native'
import type { PortablePayload, PortableRotationProgram } from './compiler'
import { TEAM_INPUT } from './layout'

interface Scratch { inputs: Float64Array }
const scratches = new WeakMap<PortableRotationProgram, Scratch>()
export function portableScratch(program: PortableRotationProgram): Scratch {
  let scratch = scratches.get(program)
  if (!scratch) {
    scratch = { inputs: new Float64Array(TEAM_INPUT.count) }
    scratches.set(program, scratch)
  }
  return scratch
}

/** populate the compact numeric boundary. keep the selected main in slot zero,
 * as a materialized build does. set counts deduplicate catalog kinds per set. */
export function preparePortableInputs(payload: Pick<PortablePayload, 'stats' | 'sets' | 'kinds'>, combo: ArrayLike<number>, inputs: Float64Array) {
  inputs.fill(0)
  inputs[TEAM_INPUT.selfMainEchoEffects] = 1
  for (let position = 0; position < combo.length; position++) {
    const row = combo[position]!, set = payload.sets[row]!
    if (row < 0 || row >= payload.sets.length) continue
    for (let stat = 0; stat < 20; stat++) inputs[TEAM_INPUT.totals + stat]! += payload.stats[row * 20 + stat]!
    let duplicate = false
    for (let previous = 0; previous < position; previous++) {
      const other = combo[previous]!
      if (payload.sets[other] === set && payload.kinds[other] === payload.kinds[row]) { duplicate = true; break }
    }
    if (!duplicate) inputs[TEAM_INPUT.setCounts + set]!++
  }
}

function fillMainInputs(payload: Pick<PortablePayload, 'stats' | 'sets' | 'kinds'>, program: PortableRotationProgram, combo: ArrayLike<number>, main: number, inputs: Float64Array) {
  inputs.fill(0, 0, TEAM_INPUT.setCounts)
  inputs.fill(0, TEAM_INPUT.echoIds, TEAM_INPUT.totals)
  let slot = 0
  for (let position = -1; position < 5; position++) {
    const row = position === -1 ? main : combo[position]!
    if (position !== -1 && row === main) continue
    if (!Number.isInteger(row) || row < 0 || row >= payload.sets.length || slot >= 5) continue
    for (let stat = 0; stat < 20; stat++) inputs[slot * 20 + stat] = payload.stats[row * 20 + stat]!
    inputs[TEAM_INPUT.echoIds + slot] = program.echoSymbols[row]!
    inputs[TEAM_INPUT.echoSets + slot] = payload.sets[row]!
    inputs[TEAM_INPUT.presence + slot] = 1
    slot++
  }
  inputs[TEAM_INPUT.mainId] = program.echoSymbols[main] ?? 0
  inputs[TEAM_INPUT.mainPosition] = 0
}

export function fillPortableInputs(payload: Pick<PortablePayload, 'stats' | 'sets' | 'kinds'>, program: PortableRotationProgram, combo: ArrayLike<number>, main: number, inputs: Float64Array) {
  preparePortableInputs(payload, combo, inputs)
  fillMainInputs(payload, program, combo, main, inputs)
}

type ComboEvaluator = (stats: Float32Array, sets: Uint8Array, symbols: Uint32Array[], combo: Int32Array, locked: number, inputs: Float64Array, constraints: Float32Array, passes: typeof psssCstrs, result: Float64Array) => Float64Array
const comboEvaluators = new WeakMap<object, { evaluate: ComboEvaluator; symbols: Uint32Array[]; result: Float64Array }>()
export function preparePortableScorer(payload: PortablePayload) {
  const key = payload.weaponPrograms?.length ? payload.weaponPrograms : payload.rotationProgram
  let cached = comboEvaluators.get(key)
  if (cached) return cached
  const programs = payload.weaponPrograms?.length ? payload.weaponPrograms : [payload.rotationProgram]
  const row = (slot: number) => slot === 0 ? 'combo[position]' : `combo[${slot - 1} >= position ? ${slot} : ${slot - 1}]`
  const code = arithmeticSource(mergeRotationScalars(programs.map((program) => program.scalar)), {
    language: 'js', invariant: mainInvariantInput,
    input: (index) => {
      if (index < 100) return `stats[${row(Math.floor(index / 20))} * 20 + ${index % 20}]`
      if (index < TEAM_INPUT.echoIds || (index >= TEAM_INPUT.totals && index < TEAM_INPUT.count)) return `inputs[${index}]`
      if (index >= TEAM_INPUT.echoSets && index < TEAM_INPUT.mainId) return `sets[${row(index - TEAM_INPUT.echoSets)}]`
      if (index === TEAM_INPUT.mainPosition) return '0'
      if (index >= TEAM_INPUT.presence && index < TEAM_INPUT.totals) return '1'
      const weapon = Math.floor((index - TEAM_INPUT.count) / 6), slot = (index - TEAM_INPUT.count) % 6
      return `symbols[${weapon}][${row(slot === 5 ? 0 : slot)}]`
    },
  })
  const choices = programs.map((_, weapon) => {
    const out = code.outputs.slice(weapon * 8, (weapon + 1) * 8)
    return `if ((${out[0]} > result[0] || (${out[0]} > 0 && ${out[0]} === result[0] && ${weapon} < result[2])) && (!constraints.length || passes(constraints, ${out[1]}, ${out[2]}, ${out[3]}, ${out[4]} / 100, ${out[5]} / 100, ${out[6]}, 1 + ${out[7]} / 100, ${out[0]}))) {
      result[0] = ${out[0]}; result[1] = combo[position]; result[2] = ${weapon};
    }`
  }).join('\n')
  const evaluate = new Function('stats', 'sets', 'symbols', 'combo', 'locked', 'inputs', 'constraints', 'passes', 'result', `"use strict";
    result[0] = 0; ${code.prepare}
    for (let position = 0; position < 5; position++) {
      if ((locked === ${MAIN_FIRST} && position !== 0) || (locked >= 0 && combo[position] !== locked)) continue;
      ${code.evaluate}
      ${choices}
    }
    return result;`) as ComboEvaluator
  cached = { evaluate, symbols: programs.map((program) => program.echoSymbols), result: new Float64Array(3) }
  comboEvaluators.set(key, cached)
  return cached
}

export function evaluatePortableCombo(payload: PortablePayload, combo: Int32Array, lockedMain: number): { damage: number; mainIndex: number; weaponIndex?: number } | null {
  let cost = 0
  for (const row of combo) { if (row < 0 || row >= payload.costs.length) return null; cost += payload.costs[row]! }
  if (cost > MAX_ECHO_COST) return null
  const prepared = portableScratch(payload.rotationProgram).inputs
  preparePortableInputs(payload, combo, prepared)
  const scorer = preparePortableScorer(payload)
  const result = scorer.evaluate(payload.stats, payload.sets, scorer.symbols, combo, lockedMain, prepared, payload.constraints, psssCstrs, scorer.result)
  return result[0]! > 0 ? { damage: result[0]!, mainIndex: result[1]!, ...(payload.weaponPrograms?.length ? { weaponIndex: result[2]! } : {}) } : null
}

// kept rows can number in the tens of thousands and the interpreter spends
// ~100us on each, so rows read a slice of the outputs through code compiled once
// per program. same f64 ops, so results are bit-identical to executeScalarProgram
type OutputFn = (inputs: Float64Array, out: Float64Array) => Float64Array
const outputFns = new WeakMap<ScalarProgram, Map<string, OutputFn>>()
function outputFn(program: ScalarProgram, from: number, to: number): OutputFn {
  let byRange = outputFns.get(program)
  if (!byRange) outputFns.set(program, byRange = new Map())
  let fn = byRange.get(`${from}:${to}`)
  if (!fn) {
    const code = arithmeticSource({ ...program, outputs: program.outputs.subarray(from, to) }, {
      language: 'js', input: (index) => `inputs[${index}]`,
    })
    fn = new Function('inputs', 'out', `"use strict"; ${code.helpers}
      ${code.prepare}
      ${code.evaluate}
      ${code.outputs.map((value, index) => `out[${index}] = ${value};`).join(' ')}
      return out;`) as OutputFn
    byRange.set(`${from}:${to}`, fn)
  }
  return fn
}

function readOutputs(payload: PortablePayload, combo: Int32Array, main: number, weapon: number, scalar: 'scalar' | 'displayScalar', from: number, to: number, out: Float64Array) {
  const program = weapon >= 0 ? payload.weaponPrograms![weapon]! : payload.rotationProgram
  const inputs = portableScratch(program).inputs
  fillPortableInputs(payload, program, combo, main, inputs)
  return outputFn(program[scalar], from, to)(inputs, out)
}

const damageOut = new Float64Array(1)
/** the f64 total alone. */
export function materializePortableDamage(payload: PortablePayload, combo: Int32Array, main: number, weapon = -1): number {
  return readOutputs(payload, combo, main, weapon, 'scalar', 0, 1, damageOut)[0]!
}

const statsOut = new Float64Array(8)
/** the build's sheet at rest (no hit), the stats limits check and rows show. */
export function materializePortableStats(payload: PortablePayload, combo: Int32Array, main: number, weapon = -1): OptResultStats {
  const out = readOutputs(payload, combo, main, weapon, 'displayScalar', 1, 9, statsOut)
  return { atk: out[0]!, hp: out[1]!, def: out[2]!, cr: out[3]!, cd: out[4]!, er: out[5]!, bonus: out[6]!, amp: out[7]! }
}
