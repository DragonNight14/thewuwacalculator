/*
  Author: Runor Ewhro
  description: explores valid echo set plans, evaluates each plan against
               the current suggestion context, and returns the strongest
               feasible set-plan recommendations.
*/

import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import { getEchoById, getEchoSets, listChsByCos } from '@/data/catalog/echoCatalogService'
import { listEffectsFor } from '@/data/catalog/gameDataService'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'
import { rotationMainEchoCanContribute } from '@/engine/rotation/candidateScorer'
import { applySetPlan, prepSetPlanFsb } from '@/engine/suggestions/mutate'
import type { SuggestContext } from '@/engine/suggestions/types'
import {
  getSetCntBkt,
  getSetRowFfs,
  SET_ROT_TOGGLES,
  SETCNSTLUTRO,
  SETRTTGLST14,
  SETRTTGLST22,
  SETRTTGLST29,
  SETRTTGLST33,
} from '@/engine/search/encode/sets'
import {
  evalSuggChs,
  evalSuggChsW,
  mkSuggMainEc,
  mkNeutralSuggMainEc,
  mkPrepSetPla,
  getLgblDrctE,
  runSuggSmlt,
  resSuggDmg,
  suggestionCandidateKey,
  type SuggestionScoreCandidate,
} from '@/engine/suggestions/shared'
import type {
  PrepSetPlanS,
  SetPlanDisplayEntry,
  SetPlanSuggest,
  SetPlanSuggs,
  SetPlanSugoi,
} from '@/engine/suggestions/types'
import type { SetPlanEntry } from '@/engine/search/combos/setPlans'
import {
  calcSetPlan,
  calcRotSetPlan,
  prepareNeutralSetCandidate,
} from '@/engine/suggestions/setPlan/compute'
import type { EchoInstance } from '@/domain/entities/runtime'

type DisplayAccumulator = {
  pieces: number
  setIds: Set<number>
}

type DamageResult = {
  avgDamage: number
  mainEchoId?: string
  mainEchoSetId?: number
}

type MainEchoChoice = { id: string; setId: number }
type SearchSet = { id: number; type: '5pc' | '3pc' | '1pc' }

function searchSets(fivePcSets: number[], thrPcSets: number[]): SearchSet[] {
  return [
    ...fivePcSets.map((id) => ({ id, type: '5pc' as const })),
    ...thrPcSets.map((id) => ({ id, type: '3pc' as const })),
    ...ECHO_SET_DEFS.filter((entry) => entry.setMax === 1).map((entry) => ({ id: entry.id, type: '1pc' as const })),
  ]
}

function* enumerateSetPlans(sets: SearchSet[], index = 0, used = 0, plan: SetPlanEntry[] = []): Generator<SetPlanEntry[]> {
  if (index === sets.length) {
    if (used > 0) yield plan.map((entry) => ({ ...entry }))
    return
  }
  yield* enumerateSetPlans(sets, index + 1, used, plan)
  const { id, type } = sets[index]!
  for (const pieces of type === '5pc' ? [2, 5] : type === '3pc' ? [3] : [1]) {
    if (used + pieces > 5) continue
    plan.push({ setId: id, pieces })
    yield* enumerateSetPlans(sets, index + 1, used + pieces, plan)
    plan.pop()
  }
}

/** the same neutral candidates the synchronous enumerator will request.
 * parallel scoring only fills its score cache; ranking/filtering stays serial. */
function* neutralSetPlans(input: PrepSetPlanS): Generator<SetPlanEntry[]> {
  const current = input.qppdChs
  const count = current.filter(Boolean).length
  if (!count) return
  const feasible = prepSetPlanFsb(current)
  const sets = searchSets(
    ECHO_SET_DEFS.filter((entry) => entry.setMax === 5).map((entry) => entry.id),
    ECHO_SET_DEFS.filter((entry) => entry.setMax === 3).map((entry) => entry.id),
  )
  const seen = new Set<string>()
  const initial: SetPlanEntry[][] = [[], ...sets.map(({ id, type }) => [{ setId: id, pieces: type === '5pc' ? 2 : type === '3pc' ? 3 : 1 }])]
  for (const plan of initial) {
    const key = JSON.stringify(plan)
    if (!seen.has(key)) { seen.add(key); yield plan }
  }
  for (const plan of enumerateSetPlans(sets)) {
    const key = JSON.stringify(plan)
    if (plan.reduce((sum, entry) => sum + entry.pieces, 0) <= count && feasible(plan) && !seen.has(key)) { seen.add(key); yield plan }
  }
}
export function countNeutralSetCandidates(input: PrepSetPlanS): number {
  let count = 0
  for (const _plan of neutralSetPlans(input)) { void _plan; count++ }
  return count
}
export function* iterateNeutralSetCandidates(input: PrepSetPlanS): Generator<SuggestionScoreCandidate> {
  const base = input.qppdChs.map((echo) => echo ? { ...echo, set: 0 } : null)
  for (const plan of neutralSetPlans(input)) yield prepareNeutralSetCandidate(input.context, plan, base)
}
export function prepareNeutralSetCandidates(input: PrepSetPlanS): SuggestionScoreCandidate[] {
  const candidates = new Map<string, SuggestionScoreCandidate>()
  for (const candidate of iterateNeutralSetCandidates(input)) candidates.set(suggestionCandidateKey(candidate), candidate)
  return [...candidates.values()]
}

function setEffectSig(ctx: SuggestContext, entry: SetPlanEntry): string {
  const row = getSetRowFfs(entry.setId, getSetCntBkt(entry.pieces))
  const totals: number[] = []
  for (let index = 0; index < SETCNSTLUTRO; index += 1) {
    totals.push(ctx.setConstLut[row + index] ?? 0)
  }

  const hasSpecialState =
      (entry.setId === 14 && entry.pieces >= 5 && (ctx.setRtMask & SETRTTGLST14) !== 0)
      || (entry.setId === 22 && (ctx.setRtMask & (SETRTTGLST22 | SET_ROT_TOGGLES)) !== 0)
      || (entry.setId === 29 && entry.pieces >= 5 && (ctx.setRtMask & SETRTTGLST29) !== 0)
      || (entry.setId === 33 && entry.pieces >= 5 && (ctx.setRtMask & SETRTTGLST33) !== 0)

  return `${totals.join(',')}|${hasSpecialState ? `${entry.setId}:${entry.pieces}` : ''}`
}

function setDisplayKey(ctx: SuggestContext, entry: SetPlanEntry): string {
  return `${entry.pieces}|${setEffectSig(ctx, entry)}`
}

function setEffectPlanKey(ctx: SuggestContext, setPlan: SetPlanEntry[]): string {
  return displaySlotsFor(ctx, setPlan)
      .map(({ key }) => key)
      .join('||')
}

function displaySlotsFor(ctx: SuggestContext, setPlan: SetPlanEntry[]): Array<{
  key: string
  entry: SetPlanEntry
}> {
  const seen = new Map<string, number>()
  return setPlan
      .map((entry) => {
        const baseKey = setDisplayKey(ctx, entry)
        const occurrence = seen.get(baseKey) ?? 0
        seen.set(baseKey, occurrence + 1)
        return {
          key: `${baseKey}#${occurrence}`,
          entry,
        }
      })
      .sort((left, right) => left.key.localeCompare(right.key))
}

function makeDisplayPlan(
    displayByKey: Map<string, DisplayAccumulator>,
): SetPlanDisplayEntry[] {
  const setIdsByBaseKey = new Map<string, Set<number>>()
  for (const [key, display] of displayByKey.entries()) {
    const baseKey = key.slice(0, key.lastIndexOf('#'))
    const setIds = setIdsByBaseKey.get(baseKey) ?? new Set<number>()
    for (const setId of display.setIds) {
      setIds.add(setId)
    }
    setIdsByBaseKey.set(baseKey, setIds)
  }

  return [...displayByKey.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, display]) => ({
        pieces: display.pieces,
        setIds: [...(setIdsByBaseKey.get(key.slice(0, key.lastIndexOf('#'))) ?? display.setIds)]
            .sort((left, right) => left - right),
      }))
      .sort((left, right) =>
        right.pieces - left.pieces || (left.setIds[0] ?? 0) - (right.setIds[0] ?? 0),
      )
}

function displayEntriesFor(result: SetPlanSuggest): SetPlanEntry[] {
  if (result.displayPlan?.length) {
    return result.displayPlan.flatMap((entry) =>
      entry.setIds.map((setId) => ({ setId, pieces: entry.pieces })),
    )
  }

  return result.setPlan
}

function sameDamage(left: number, right: number, eps: number): boolean {
  return Math.abs(left - right) <= Math.max(eps, Math.abs(left) * 1e-6, Math.abs(right) * 1e-6)
}

function realizesSetPlan(echoes: Array<EchoInstance | null>, plan: SetPlanEntry[]): boolean {
  const counts = countEchoSets(echoes)
  for (const echo of echoes) {
    if (!echo) continue
    if (!getEchoSets(echo.id).includes(echo.set)) return false
  }
  for (const entry of plan) {
    if ((counts[entry.setId] ?? 0) < entry.pieces) return false
  }
  for (const [key, pieces] of Object.entries(counts)) {
    const setId = Number(key)
    const max = ECHO_SET_DEFS.find((set) => set.id === setId)?.setMax
    const threshold = max === 1 ? 1 : max === 3 ? 3 : 2
    if (pieces >= threshold && !plan.some((entry) => entry.setId === setId)) return false
  }
  return true
}

export function collapseScoredDamageTies(results: SetPlanSuggest[]): SetPlanSuggest[] {
  const counts = results.map((result) => new Map(result.setPlan.map((entry) => [entry.setId, entry.pieces])))
  // equal totals only establish redundancy when a subset of the same set
  // bonuses achieves that total with the same main Echo. independent plans
  // remain alternatives regardless of their bonus counts or piece counts.
  return results.filter((result, index) => !results.some((other, otherIndex) => {
    if (index === otherIndex || result.mainEchoId !== other.mainEchoId
      || result.mainEchoSetId !== other.mainEchoSetId
      || !sameDamage(result.avgDamage, other.avgDamage, 1e-6)) return false
    const subset = counts[otherIndex]!
    const full = counts[index]!
    if (![...subset].every(([setId, pieces]) => pieces <= (full.get(setId) ?? 0))) return false
    const strict = [...full].some(([setId, pieces]) => pieces > (subset.get(setId) ?? 0))
    return strict || other.avgDamage > result.avgDamage
      || (other.avgDamage === result.avgDamage && otherIndex < index)
  })).sort((left, right) => right.avgDamage - left.avgDamage)
}

export function groupEquivalentSetPlans(
    results: SetPlanSuggest[],
    ctx: SuggestContext,
    eps: number,
): SetPlanSuggest[] {
  // the packed self-set row only finds candidates for equivalence. A set can
  // also buff teammates or change its main Echo, so only combine complete
  // plans after their actual rotation scores agree.
  type ScoredGroup = { representative: SetPlanSuggest; members: SetPlanSuggest[] }
  const grouped = new Map<string, ScoredGroup[]>()

  for (const result of results) {
    const displayEntries = displayEntriesFor(result)
    const key = setEffectPlanKey(ctx, displayEntries)
    const rows = grouped.get(key) ?? []
    const existing = rows.find((entry) => sameDamage(entry.representative.avgDamage, result.avgDamage, eps))

    if (existing) {
      existing.members.push(result)
      if (result.avgDamage > existing.representative.avgDamage) existing.representative = result
    } else {
      rows.push({ representative: result, members: [result] })
    }
    grouped.set(key, rows)
  }

  return [...grouped.values()].flat().map(({ representative: result, members }) => {
    const usedElsewhere = new Set(result.setPlan.map((entry) => entry.setId))
    const displayByKey = new Map<string, DisplayAccumulator>()
    for (const member of members) {
      for (const { key, entry } of displaySlotsFor(ctx, displayEntriesFor(member))) {
        const display = displayByKey.get(key) ?? { pieces: entry.pieces, setIds: new Set<number>() }
        if (member === result || !usedElsewhere.has(entry.setId)) display.setIds.add(entry.setId)
        displayByKey.set(key, display)
      }
    }
    return { ...result, displayPlan: makeDisplayPlan(displayByKey) }
  })
      .sort((left, right) => right.avgDamage - left.avgDamage)
}

function usefulSetPlan(
    setPlan: SetPlanEntry[],
    avgDamage: number,
    scorePlan: (setPlan: SetPlanEntry[]) => DamageResult,
    eps: number,
): SetPlanEntry[] {
  return setPlan.filter((_, index) => {
    const withoutEntry = [
      ...setPlan.slice(0, index),
      ...setPlan.slice(index + 1),
    ]
    const withoutDamage = scorePlan(withoutEntry).avgDamage
    return !sameDamage(avgDamage, withoutDamage, eps)
  })
}

// enumerate and evaluate set plans for either direct or rotation mode
export function sggsSetPlns({
                                  ctx,
                                  rotationCtx = null,
                                  fivePcSets: fivePcSets = [],
                                  thrPcSets: thrPcSets = [],
                                  topK = 10,
                                  exhaustive = false,
                                  qppdChs: qppdChs = [],
                                  scorePlan,
                                  isFeasible,
                                }: {
  ctx: SuggestContext | null
  rotationCtx?: SuggestContext | null
  fivePcSets?: number[]
  thrPcSets?: number[]
  topK?: number
  exhaustive?: boolean
  qppdChs?: Array<EchoInstance | null>
  scorePlan?: (setPlan: SetPlanEntry[]) => DamageResult
  isFeasible?: (setPlan: SetPlanEntry[]) => boolean
}): { baseAvg: number; results: SetPlanSuggest[] } {
  const results: SetPlanSuggest[] = []
  const isRotMode = rotationCtx != null

  // clear current set assignments. every candidate starts from a neutral
  // baseline with no existing set bonuses.
  const baseEchoes: Array<EchoInstance | null> = qppdChs.map(
      (echo) => (echo ? { ...echo, set: 0 } : null),
  )

  // useful-piece comparisons isolate set bonuses on a neutral loadout.
  // full candidate simulation can also change echo bodies and inherit worn
  // filler sets, which must not make an otherwise useless piece contribute.
  const computeNeutralDamage = isRotMode
      ? (setPlan: SetPlanEntry[]) =>
          calcRotSetPlan(rotationCtx!, setPlan, baseEchoes)
      : (setPlan: SetPlanEntry[]) =>
          calcSetPlan(ctx!, setPlan, baseEchoes)
  // subset checks revisit the same neutral plans. retain their exact score
  // for this search, including any stat-sensitive teammate replay.
  const neutralScores = new Map<string, ReturnType<typeof computeNeutralDamage>>()
  const cmptDmg: typeof computeNeutralDamage = (plan) => {
    const key = JSON.stringify(plan)
    let result = neutralScores.get(key)
    if (!result) {
      result = computeNeutralDamage(plan)
      neutralScores.set(key, result)
    }
    return result
  }

  // baseline damage with no set-plan override at all
  const baseDmg = cmptDmg([])
  const baseAvg = baseDmg.avgDamage

  // numeric tolerance for equality comparisons
  const eps = Math.max(1e-6, Math.abs(baseAvg) * 1e-6)

  // flatten the selectable set list into a dfs-friendly array
  const allSets = searchSets(fivePcSets, thrPcSets)

  // cache partial-piece baselines such as 2pc and 3pc for suppression of
  // redundant mixed plans that are effectively identical to a standalone partial set
  const pcBsln = new Map<string, number>()

  for (const { id, type } of allSets) {
    if (type === '5pc') {
      const dmg2 = cmptDmg([{ setId: id, pieces: 2 }])
      pcBsln.set(`${id}:2`, dmg2.avgDamage)
    } else if (type === '3pc') {
      const dmg3 = cmptDmg([{ setId: id, pieces: 3 }])
      pcBsln.set(`${id}:3`, dmg3.avgDamage)
    } else if (type === '1pc') {
      const dmg1 = cmptDmg([{ setId: id, pieces: 1 }])
      pcBsln.set(`${id}:1`, dmg1.avgDamage)
    }
  }

  // evaluate one concrete set-plan candidate and maybe keep it
  function maybeInsert(setPlan: SetPlanEntry[], totalPieces: number) {
    if (isFeasible && !isFeasible(setPlan)) return
    const dmg = cmptDmg(setPlan)

    const avg = dmg.avgDamage

    // skip plans that are effectively identical to the no-plan baseline
    if (Math.abs(avg - baseAvg) <= eps) {
      return
    }

    // if a mixed plan performs the same as one cached partial baseline,
    // drop it unless it is exactly that standalone partial plan
    for (const entry of setPlan) {
      if (entry.pieces === 2 || entry.pieces === 3 || entry.pieces === 1) {
        const key = `${entry.setId}:${entry.pieces}`
        const baseline = pcBsln.get(key)

        if (typeof baseline === 'number') {
          const localEps = Math.max(eps, Math.abs(baseline) * 1e-6)

          if (Math.abs(avg - baseline) <= localEps) {
            const isStandalone =
                setPlan.length === 1 && totalPieces === entry.pieces

            if (!isStandalone) {
              return
            }
          }
        }
      }
    }

    const neutralUsefulPlan = usefulSetPlan(setPlan, avg, cmptDmg, eps)
    if (neutralUsefulPlan.length === 0) {
      return
    }

    // also check usefulness against the actual candidate score. neutral set
    // rows can overstate a set whose damage type does not occur in this rotation.
    const candidateAvg = scorePlan ? scorePlan(neutralUsefulPlan).avgDamage : avg
    if (!Number.isFinite(candidateAvg)) return
    const candidateEps = Math.max(eps, Math.abs(candidateAvg) * 1e-6)
    const usefulPlan = scorePlan
      ? usefulSetPlan(neutralUsefulPlan, candidateAvg, scorePlan, candidateEps)
      : neutralUsefulPlan
    if (usefulPlan.length === 0) {
      return
    }

    // the final score is calculated from exactly the useful plan we return.
    const scored = scorePlan ? scorePlan(usefulPlan) : { avgDamage: avg }
    if (!Number.isFinite(scored.avgDamage)) return

    results.push({
      avgDamage: scored.avgDamage,
      setPlan: [...usefulPlan].map((entry) => ({
        setId: entry.setId,
        pieces: entry.pieces,
      })),
      mainEchoId: scored.mainEchoId,
      mainEchoSetId: scored.mainEchoSetId,
      displayPlan: usefulPlan.map((entry) => ({
        setIds: [entry.setId],
        pieces: entry.pieces,
      })),
      echoes: qppdChs,
    })

    // in non-exhaustive mode, keep only the current top k as we go
    if (!exhaustive && topK > 0) {
      results.sort((a, b) => b.avgDamage - a.avgDamage)
      if (results.length > topK) {
        results.length = topK
      }
    }
  }

  for (const plan of enumerateSetPlans(allSets)) {
    maybeInsert(plan, plan.reduce((sum, entry) => sum + entry.pieces, 0))
  }

  // exhaustive mode collects everything first, then sorts once at the end
  if (exhaustive) {
    results.sort((a, b) => b.avgDamage - a.avgDamage)
  }

  return {
    baseAvg,
    results: results.map((result) => ({
      setPlan: result.setPlan,
      displayPlan: result.displayPlan,
      avgDamage: result.avgDamage,
      mainEchoId: result.mainEchoId,
      mainEchoSetId: result.mainEchoSetId,
      echoes: result.echoes,
    })),
  }
}

// run the full set-plan suggestor pipeline from simulation to filtered output
export function runSetSggs(
    input: SetPlanSuggs,
    options: {
      fivePcSets?: number[]
      thrPcSets?: number[]
      topK?: number
    } = {},
): SetPlanSugoi {
  const rotationMode = input.rotationMode

  // first simulate the current state to build the suggestion context
  const simulation = runSuggSmlt(input)
  const prepared = mkPrepSetPla(input, simulation)
  if (!prepared) {
    return { baseAvg: 0, results: [], isRotation: rotationMode }
  }

  return scorePreparedSetPlans(prepared, options)
}

export function runPrepSetSg(input: PrepSetPlanS): SetPlanSugoi {
  return scorePreparedSetPlans(input)
}

// score concrete, feasible plans before grouping. rotation candidates reuse
// the frozen damage plan while their Echo stats, sets and main body vary.
function scorePreparedSetPlans(
    input: PrepSetPlanS,
    options: { fivePcSets?: number[], thrPcSets?: number[], topK?: number } = {},
): SetPlanSugoi {
  const currentEchoes = input.qppdChs
  const nonNullCount = currentEchoes.filter((echo) => echo != null).length
  if (nonNullCount === 0) {
    return { baseAvg: 0, results: [], isRotation: input.rotationMode }
  }

  const feasible = prepSetPlanFsb(currentEchoes)
  const scores = new Map<string, DamageResult>()
  const materializedScores = new Map<string, DamageResult>()
  const mainBuffs = new Map<string, Float32Array>()
  const costs = new Set(currentEchoes.flatMap((echo) => {
    const cost = echo && getEchoById(echo.id)?.cost
    return cost ? [cost] : []
  }))
  const hasEchoDamage = input.context.mode === 'rotation'
    ? input.context.sklls.some((skill) => skill.tab === 'echoAttacks')
    : input.context.skll.tab === 'echoAttacks'
  // immunity-only Echoes cannot improve damage; resolve eligible definitions
  // once per distinct cost.
  let mainEchoPool = [...costs].flatMap(listChsByCos).filter((definition) => (
    hasEchoDamage || listEffectsFor('echo', definition.id).some((effect) => (
      effect.operations.some((operation) => operation.type !== 'add_immunity')
    ))
  ))
  const onePieceSets = new Set(ECHO_SET_DEFS.filter((set) => set.setMax === 1).map((set) => set.id))
  const candidateKey = (echoes: Array<EchoInstance | null>) => JSON.stringify(echoes.map((echo) => echo ? [
    echo.id, echo.set, echo.mainEcho, echo.mainStats, echo.substats,
  ] : null))
  const baseSimulation = input.rotationMode ? null : runSuggSmlt(input.scoringInput)
  const targetFeatureId = baseSimulation ? getLgblDrctE(baseSimulation, input.scoringInput)?.id : undefined
  const baseAvg = input.rotationMode
    ? evalSuggChs(input.context, currentEchoes)
    : resSuggDmg(baseSimulation, input.scoringInput)
  materializedScores.set(candidateKey(currentEchoes), { avgDamage: baseAvg })
  if (input.context.mode === 'rotation' && input.context.candidatePlan) {
    const plan = input.context.candidatePlan
    mainEchoPool = mainEchoPool.filter((definition) => rotationMainEchoCanContribute(plan, definition.id))
  }
  const targetMainBuffs = (echo: EchoInstance): Float32Array => {
    const key = `${echo.id}:${echo.set}`
    let buffs = mainBuffs.get(key)
    if (!buffs) {
      // the targeted row uses this main and the frozen source context.
      buffs = mkSuggMainEc(input.context, [echo])
      mainBuffs.set(key, buffs)
    }
    return buffs
  }
  if (input.context.mode === 'target' && !hasEchoDamage) {
    mainEchoPool = mainEchoPool.filter((definition) => {
      const source = currentEchoes.find((echo) => echo && getEchoById(echo.id)?.cost === definition.cost)!
      return definition.sets.some((set) => targetMainBuffs({ ...source, id: definition.id, set }).some((value) => value !== 0))
    })
  }
  // different concrete plans can produce the same slot bodies and active
  // sets. UIDs never participate in damage scoring.
  const echoDamage = (echoes: Array<EchoInstance | null>): number => {
    const key = candidateKey(echoes)
    const known = materializedScores.get(key)
    if (known) return known.avgDamage
    const runtime = { ...input.scoringInput.runtime, build: { ...input.scoringInput.runtime.build, echoes } }
    const scoring = { ...input.scoringInput, runtime }
    const avgDamage = input.rotationMode
      ? evalSuggChs(input.context, echoes)
      : runSuggSmlt(scoring).allSkills.find((entry) => entry.resonatorId === runtime.id && entry.id === targetFeatureId)?.avg ?? 0
    materializedScores.set(key, { avgDamage })
    return avgDamage
  }
  const contributes = (echoes: Array<EchoInstance | null>): boolean => {
    if (input.context.mode === 'target' && input.context.skll.tab === 'echoAttacks') {
      return input.context.skll.id.startsWith(`echo:${echoes[0]?.id}:`)
        && echoDamage(echoes) > 0
    }
    // use the same concrete build with its main disabled, keeping every
    // body, stat and set count fixed. the compiled rotation also includes
    // effects on teammates and damage from surviving Echo invocations.
    let buffs: Float32Array | undefined
    if (!input.rotationMode && echoes[0]) {
      buffs = targetMainBuffs(echoes[0])
      if (!buffs.some((value) => value !== 0)) return false
    }
    const full = input.rotationMode ? echoDamage(echoes)
      : evalSuggChsW(input.context, echoes, buffs!)
    const neutral = evalSuggChsW(input.context, echoes, mkNeutralSuggMainEc(echoes), true, false)
    return full - neutral > Math.max(1e-6, Math.abs(neutral) * 1e-6)
  }
  const scorePlan = (setPlan: SetPlanEntry[]): DamageResult => {
    const key = JSON.stringify(setPlan)
    const cached = scores.get(key)
    if (cached) return cached
    // the ordinary materializer supplies a legal carrier when no useful
    // main exists. such a body does not need a named main-Echo suggestion.
    const fallback = applySetPlan(setPlan, currentEchoes)
    let best: DamageResult | null = realizesSetPlan(fallback, setPlan)
      ? { avgDamage: echoDamage(fallback) } : null
    if (best && fallback[0] && contributes(fallback)) {
      best.mainEchoId = fallback[0].id
      best.mainEchoSetId = fallback[0].set
    }
    const hasFiller = setPlan.reduce((sum, entry) => sum + entry.pieces, 0) < nonNullCount
    const plannedSets = new Set(setPlan.map((entry) => entry.setId))
    for (const definition of mainEchoPool) {
      for (const setId of definition.sets) {
        if (!plannedSets.has(setId) && (!hasFiller || onePieceSets.has(setId))) continue
        const choice = { id: definition.id, setId }
        const echoes = applySetPlan(setPlan, currentEchoes, choice)
        if (echoes[0]?.id !== choice.id || echoes[0].set !== choice.setId
          || !realizesSetPlan(echoes, setPlan) || !contributes(echoes)) continue
        const avgDamage = echoDamage(echoes)
        // prefer a contributing named main on ties, then retain catalog order.
        if (!best || avgDamage > best.avgDamage || (avgDamage === best.avgDamage && !best.mainEchoId)) {
          best = { avgDamage, mainEchoId: choice.id, mainEchoSetId: choice.setId }
        }
      }
    }
    const result = best ?? { avgDamage: Number.NEGATIVE_INFINITY }
    scores.set(key, result)
    return result
  }

  const { results } = sggsSetPlns({
    ctx: input.rotationMode ? null : input.context,
    rotationCtx: input.rotationMode ? input.context : null,
    fivePcSets: options.fivePcSets ?? ECHO_SET_DEFS.filter((entry) => entry.setMax === 5).map((entry) => entry.id),
    thrPcSets: options.thrPcSets ?? ECHO_SET_DEFS.filter((entry) => entry.setMax === 3).map((entry) => entry.id),
    topK: options.topK ?? input.topK ?? 10,
    exhaustive: true,
    qppdChs: currentEchoes,
    scorePlan,
    isFeasible: (plan) => plan.reduce((sum, entry) => sum + entry.pieces, 0) <= nonNullCount && feasible(plan),
  })

  const eps = Math.max(1e-6, Math.abs(baseAvg) * 1e-6)
  // keep the scored main Echo fixed while testing each set entry's contribution.
  const scoreWithMain = (plan: SetPlanEntry[], choice: MainEchoChoice): number | null => {
    const echoes = applySetPlan(plan, currentEchoes, choice)
    if (echoes[0]?.id !== choice.id || echoes[0].set !== choice.setId
      || !realizesSetPlan(echoes, plan)) return null
    return echoDamage(echoes)
  }
  const removeRedundantSets = (result: SetPlanSuggest): SetPlanSuggest => {
    if (!result.mainEchoId || result.mainEchoSetId == null) return result
    const choice = { id: result.mainEchoId, setId: result.mainEchoSetId }
    let plan = [...result.setPlan]
    let damage = scoreWithMain(plan, choice)
    if (damage == null) return result

    for (let index = 0; index < plan.length;) {
      const entry = plan[index]
      // a one-piece set is intrinsic to its Echo and cannot be represented
      // by a main-only candidate with no active set bonus.
      if (entry.setId === choice.setId
        && ECHO_SET_DEFS.find((set) => set.id === entry.setId)?.setMax === 1) {
        index += 1
        continue
      }
      const reduced = plan.filter((_, at) => at !== index)
      const reducedDamage = scoreWithMain(reduced, choice)
      if (reducedDamage != null && sameDamage(damage, reducedDamage, eps)) {
        plan = reduced
        damage = reducedDamage
      } else {
        // the 2pc bonus can contribute while the same set's 5pc bonus does
        // nothing. keep only the useful threshold, with the main held fixed.
        const lower = entry.pieces === 5
          && ECHO_SET_DEFS.find((set) => set.id === entry.setId)?.setMax === 5
          ? plan.map((part, at) => at === index ? { ...part, pieces: 2 } : part)
          : null
        const lowerDamage = lower ? scoreWithMain(lower, choice) : null
        if (lower && lowerDamage != null && sameDamage(damage, lowerDamage, eps)) {
          plan = lower
          damage = lowerDamage
        } else {
          index += 1
        }
      }
    }

    return {
      ...result,
      avgDamage: damage,
      setPlan: plan,
      displayPlan: plan.map((entry) => ({ pieces: entry.pieces, setIds: [entry.setId] })),
    }
  }

  const canonicalResults = results.map(removeRedundantSets)
  // main-only candidates use the same search and caches as set candidates.
  const mainOnly = scorePlan([])
  if (mainOnly.mainEchoId) canonicalResults.push({
    ...mainOnly, setPlan: [], displayPlan: [], echoes: currentEchoes,
  })

  // removing redundant bonuses can make several searches converge on the
  // same concrete plan. keep its strongest main, including main-only rows.
  const distinct = new Map<string, SetPlanSuggest>()
  for (const result of canonicalResults) {
    const key = result.setPlan.map((entry) => `${entry.setId}:${entry.pieces}`).sort().join('|')
    const previous = distinct.get(key)
    if (!previous || result.avgDamage > previous.avgDamage) distinct.set(key, result)
  }

  return {
    baseAvg,
    results: collapseScoredDamageTies(groupEquivalentSetPlans([...distinct.values()], input.context, eps)),
    isRotation: input.rotationMode,
  }
}
