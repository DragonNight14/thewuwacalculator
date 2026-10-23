/*
  Author: Runor Ewhro
  description: evaluates one retained optimizer combination against a packed
               target context and returns its constrained damage/stat snapshot.
*/

import type { OptResultStats } from '@/engine/search/score/core.ts'
import { ECHO_STAT_STRIDE, MAIN_BUFF_LEN, SET_SLOT_COUNT } from '@/engine/search/layout/constants.ts'
import { applySetVec } from '@/engine/search/encode/sets.ts'
import { countOneBits } from '@/engine/search/score/specialMath.ts'
import { LIMIT_FAILED, mkTgtComboTerms, tgtComboTerms, tgtCtx, tgtMainDamage } from '@/engine/search/score/core.ts'

// compute unique set-piece counts for the chosen combo
function mkCmbSetCnts(
    sets: Uint8Array,
    kinds: Uint16Array,
    comboIds: Int32Array,
): Uint8Array {
  const setCounts = new Uint8Array(SET_SLOT_COUNT)
  const setMask = new Uint32Array(SET_SLOT_COUNT)

  for (let index = 0; index < comboIds.length; index += 1) {
    const echoIndex = comboIds[index]
    const setId = sets[echoIndex]
    if (setId < 0 || setId >= SET_SLOT_COUNT) {
      continue
    }

    // kind IDs deduplicate set pieces from Echoes of the same kind.
    const bit = (1 << (kinds[echoIndex] & 31)) >>> 0
    setMask[setId] |= bit
  }

  for (let setId = 0; setId < SET_SLOT_COUNT; setId += 1) {
    setCounts[setId] = countOneBits(setMask[setId])
  }

  return setCounts
}

// sum the combo's raw echo stat rows (f64, combo order) before main-echo bonuses
function mkBaseStts(stats: Float32Array, comboIds: Int32Array, totals = new Float64Array(ECHO_STAT_STRIDE)): Float64Array {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0, s6 = 0, s7 = 0, s8 = 0, s10 = 0
  let s11 = 0, s12 = 0, s13 = 0, s14 = 0, s15 = 0, s16 = 0, s17 = 0, s18 = 0, s19 = 0
  for (let index = 0; index < comboIds.length; index += 1) {
    const b = comboIds[index] * ECHO_STAT_STRIDE
    s0 += stats[b]; s1 += stats[b + 1]; s2 += stats[b + 2]; s3 += stats[b + 3]; s4 += stats[b + 4]
    s5 += stats[b + 5]; s6 += stats[b + 6]; s7 += stats[b + 7]; s8 += stats[b + 8]; s10 += stats[b + 10]
    s11 += stats[b + 11]; s12 += stats[b + 12]; s13 += stats[b + 13]; s14 += stats[b + 14]; s15 += stats[b + 15]
    s16 += stats[b + 16]; s17 += stats[b + 17]; s18 += stats[b + 18]; s19 += stats[b + 19]
  }
  totals[0] = s0; totals[1] = s1; totals[2] = s2; totals[3] = s3; totals[4] = s4; totals[5] = s5; totals[6] = s6
  totals[7] = s7; totals[8] = s8; totals[10] = s10; totals[11] = s11; totals[12] = s12; totals[13] = s13
  totals[14] = s14; totals[15] = s15; totals[16] = s16; totals[17] = s17; totals[18] = s18; totals[19] = s19
  return totals
}

interface TargetEvaluationOptions {
  context: Float32Array
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
  sets: Uint8Array
  kinds: Uint16Array
  constraints?: Float32Array
  comboIds: Int32Array
  mainIndex: number
}

const terms = mkTgtComboTerms()

export function evalTarget(options: TargetEvaluationOptions): { damage: number; stats: OptResultStats } | null {
  const ctx = tgtCtx(options.context)
  const setCounts = mkCmbSetCnts(options.sets, options.kinds, options.comboIds)
  const setBonus = applySetVec(setCounts, ctx.skillMask, options.setConstLut, ctx.setRtMask)
  tgtComboTerms(ctx, mkBaseStts(options.stats, options.comboIds), setBonus, terms)
  const stats = { atk: 0, hp: 0, def: 0, er: 0, cr: 0, cd: 0, bonus: 0, amp: 0 }
  const damage = tgtMainDamage(ctx, terms, setCounts, options.mainEchoBuffs, options.mainIndex, options.constraints, stats)
  return damage === LIMIT_FAILED ? null : { damage, stats }
}

// packed contexts are immutable during a search. unpack them once, then
// prepare each candidate frame's set effects once. a trial only totals the
// changing stat rows and evaluates the shared formula, without result objects.
export function prepareTargetScoring(
  contexts: readonly Float32Array[],
  setConstLut: Float32Array,
  weights?: Float32Array,
  fixedDamage = 0,
  memoize = false,
) {
  const prepared = contexts.map(tgtCtx)
  const setGroups: Array<{ skillMask: number; runtimeMask: number }> = []
  const groupIndexes = new Map<string, number>()
  const setGroupByContext = prepared.map((context) => {
    const key = context.setGroupKey
    let index = groupIndexes.get(key)
    if (index === undefined) {
      index = setGroups.length
      setGroups.push({ skillMask: context.skillMask, runtimeMask: context.setRtMask })
      groupIndexes.set(key, index)
    }
    return index
  })

  const scores = new Map<string, number>()
  const diagnostics = { calls: 0, equivalentInputHits: 0 }
  // fixed frame inputs must not change for the lifetime of the returned scorer.
  const prepareFrame = ({ sets, kinds, comboIds, mainEchoBuffs, mainIndex }: Pick<
    TargetEvaluationOptions, 'sets' | 'kinds' | 'comboIds' | 'mainEchoBuffs' | 'mainIndex'
  >) => {
    const setCounts = mkCmbSetCnts(sets, kinds, comboIds)
    const setBonuses = setGroups.map(({ skillMask, runtimeMask }) =>
      applySetVec(setCounts, skillMask, setConstLut, runtimeMask),
    )
    const base = new Float64Array(ECHO_STAT_STRIDE)
    // set identities remain available for result materialization.
    // only share arithmetic when every value read by the packed scorer agrees.
    const effectKey = memoize ? JSON.stringify([
      setBonuses, setCounts[14] >= 5, setCounts[33] >= 5,
      Array.from(mainEchoBuffs.subarray(mainIndex * MAIN_BUFF_LEN, (mainIndex + 1) * MAIN_BUFF_LEN)),
    ]) : ''
    const calculateBase = (totals: Float64Array) => {
      let total = fixedDamage
      for (let index = 0; index < prepared.length; index += 1) {
        const ctx = prepared[index]
        tgtComboTerms(ctx, totals, setBonuses[setGroupByContext[index]], terms)
        const damage = tgtMainDamage(ctx, terms, setCounts, mainEchoBuffs, mainIndex)
        total += weights ? damage * (weights[index] ?? 1) : damage
      }
      return total
    }
    const scoreBase = (totals: Float64Array) => {
      if (!memoize) return calculateBase(totals)
      diagnostics.calls += 1
      const key = `${effectKey}|${totals.join(',')}`
      const known = scores.get(key)
      if (known !== undefined) {
        diagnostics.equivalentInputHits += 1
        return known
      }
      const value = calculateBase(totals)
      if (scores.size >= 8192) scores.delete(scores.keys().next().value!)
      scores.set(key, value)
      return value
    }
    const scorer = (stats: Float32Array) => {
      // reuse js-number totals to preserve the
      // original summation precision, including conversion thresholds.
      mkBaseStts(stats, comboIds, base)
      return scoreBase(base)
    }
    // reference-allocation trials change only the first echo's substat lane.
    // bind the other four rows once per main-stat candidate; each trial reads
    // their precomputed total.
    scorer.prepareFirstLane = (fixedStats: Float32Array) => {
      if (comboIds.length !== 5 || comboIds[0] !== 0 || comboIds[1] !== 1
        || comboIds[2] !== 2 || comboIds[3] !== 3 || comboIds[4] !== 4) return scorer
      const fixed = new Float64Array(ECHO_STAT_STRIDE)
      for (let index = 1; index < comboIds.length; index += 1) {
        const offset = comboIds[index] * ECHO_STAT_STRIDE
        for (let stat = 0; stat < ECHO_STAT_STRIDE; stat += 1) fixed[stat] += fixedStats[offset + stat]
      }
      const candidateBase = new Float64Array(ECHO_STAT_STRIDE)
      return (stats: Float32Array) => {
        for (let stat = 0; stat < ECHO_STAT_STRIDE; stat += 1) candidateBase[stat] = stats[stat] + fixed[stat]
        return scoreBase(candidateBase)
      }
    }
    return scorer
  }
  prepareFrame.diagnostics = diagnostics
  return prepareFrame
}
