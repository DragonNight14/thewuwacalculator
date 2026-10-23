/*
  Author: Runor Ewhro
  description: materializes raw optimizer rows back into user-facing result
               entries and optional recomputed stat snapshots for display.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { matThryRsltCh, theoryResultCompactor } from './theoryEchoes.ts'
export { matThryEcho, matThryRsltCh } from './theoryEchoes.ts'
import type {
  OptFinalResult,
  OptBagResult,
  OptRawResult,
  OptResultEntry,
  PckdRotXctnP,
  PackedSkill,
  PrepRotRun,
  PrepTargetSkill,
  PrepTheoryRot,
  PrepTheoryTarget,
  PrepOptPay,
  TheoryResult,
} from '@/engine/optimizer/types.ts'
import type { OptResultStats } from '@/engine/search/score/core.ts'
import { evalTarget } from '@/engine/search/score/evaluate.ts'
import { composeOneWeaponContext } from '@/engine/optimizer/target/cpu.ts'
import { fillOptBagRs } from '@/engine/optimizer/results/collector.ts'
import { packRotation } from '@/engine/optimizer/payloads/rotationPayload.ts'
import { materializePortableDamage, materializePortableStats } from '@/engine/rotation/portable/cpu'
import { packTargetSkill } from '@/engine/optimizer/payloads/targetPayload.ts'

type ThryPay = PrepTheoryTarget | PrepTheoryRot
type ThryXct = PackedSkill | PckdRotXctnP

const thryXctCch = new WeakMap<ThryPay, ThryXct>()

function mkSqntCmbIds(count: number): Int32Array {
  const comboIds = new Int32Array(count)
  for (let index = 0; index < count; index += 1) {
    comboIds[index] = index
  }
  return comboIds
}

function mkThryTgtXct(payload: PrepTheoryTarget): PackedSkill {
  return {
    ...packTargetSkill(payload as unknown as PrepTargetSkill),
    stats: payload.stats,
    setConstLut: payload.setConstLut,
    mainEchoBuffs: payload.mainEchoBuffs,
    costs: payload.costs,
    sets: payload.sets,
    kinds: payload.kinds,
    lockMainReq: true,
    lockMainCands: payload.lockMainCands,
  }
}

function mkThryRotXct(payload: PrepTheoryRot): PckdRotXctnP {
  return {
    ...payload,
    mode: 'rotation',
  }
}

// theory result rows are often resolved lazily from the ui, so keep the packed
// cache the execution wrapper by payload for reuse across visible rows.
function getThryXct(payload: ThryPay): ThryXct {
  const cached = thryXctCch.get(payload)
  if (cached) {
    return cached
  }

  const execution = payload.mode === 'theoryRotation'
      ? mkThryRotXct(payload)
      : mkThryTgtXct(payload)
  thryXctCch.set(payload, execution)
  return execution
}

// recompute the detailed stat summary for one target-mode result row
function evalOptBagRs(
  execution: PackedSkill,
  result: OptBagResult,
  contextOverride?: Float32Array,
): OptResultStats | null {
  return evalOptBagEv(execution, result, contextOverride)?.stats ?? null
}

function evalOptBagEv(
  execution: PackedSkill,
  result: OptBagResult,
  contextOverride?: Float32Array,
) {
  const comboIds = fillOptBagRs(new Int32Array(5), result)
  const mainIndex = comboIds[0] ?? -1
  if (mainIndex < 0) {
    return null
  }

  return evalTarget({
    context: contextOverride ?? execution.context,
    stats: execution.stats,
    setConstLut: execution.setConstLut,
    mainEchoBuffs: execution.mainEchoBuffs,
    sets: execution.sets,
    kinds: execution.kinds,
    constraints: execution.constraints,
    comboIds,
    mainIndex,
  })
}

// one rotation result row through the compiled program, with the weapon search
// picked. stats are the build's sheet at rest, the values its limits checked
const rotComboIds = new Int32Array(5)
function scoreRotRow(execution: PckdRotXctnP, result: OptBagResult, withDamage = true): { damage: number; stats: OptResultStats | null } {
  const comboIds = fillOptBagRs(rotComboIds, result)
  const mainIndex = comboIds[0] ?? -1
  if (mainIndex < 0) return { damage: result.damage, stats: null }
  const weapon = 'weapon' in result ? (result.weapon ?? -1) : -1
  return {
    damage: withDamage ? materializePortableDamage(execution, comboIds, mainIndex, weapon) : result.damage,
    stats: materializePortableStats(execution, comboIds, mainIndex, weapon),
  }
}

// one inventory result row: damage and stats rescored on the cpu with the same
// arithmetic as the base build row, so the equipped build found again reads
// 100% (the search kernels score in f32 and land a unit or so off). rows the
// cpu cannot rescore exactly keep the search's damage.
function scoreOptRow(
  execution: PackedSkill | PckdRotXctnP,
  result: OptBagResult,
): { damage: number; stats: OptResultStats | null } {
  const weapon = 'weapon' in result ? (result.weapon ?? -1) : -1
  if (execution.mode === 'rotation') return scoreRotRow(execution, result)
  const evaluated = evalOptBagEv(execution, result)
  return {
    damage: weapon < 0 && evaluated ? evaluated.damage : result.damage,
    stats: evaluated?.stats ?? null,
  }
}

const byDamage = (left: OptResultEntry, right: OptResultEntry) => right.damage - left.damage

// resolve the concrete echo instances referenced by one optimizer result row
export function resOptRsltCh(
  bagEchoes: readonly EchoInstance[],
  result: OptBagResult,
): Array<EchoInstance | null> {
  return [
    bagEchoes[result.i0] ?? null,
    bagEchoes[result.i1] ?? null,
    bagEchoes[result.i2] ?? null,
    bagEchoes[result.i3] ?? null,
    bagEchoes[result.i4] ?? null,
  ]
}

export function evalOptBagcz(
  payload: PrepOptPay,
  result: OptBagResult,
): OptResultStats | null {
  if (payload.mode === 'theoryTarget' || payload.mode === 'theoryRotation') {
    return null
  }

  return payload.mode === 'rotation'
    ? scoreRotRow(packRotation(payload), result, false).stats
    : evalOptBagRs(
        packTargetSkill(payload),
        result,
      )
}

// materialize the final optimizer result list and cap it to the requested limit
export function matOptRslts(
  bagEchoes: readonly EchoInstance[],
  results: readonly OptBagResult[],
  options: {
    payload?: PrepTargetSkill | PrepRotRun | null
    limit?: number
  } = {},
): OptResultEntry[] {
  const finalized: OptResultEntry[] = []
  const maxItems = Math.max(1, Math.floor((options.limit ?? results.length) || 1))
  const execution = options.payload
    ? (options.payload.mode === 'rotation'
      ? packRotation(options.payload)
      : packTargetSkill(options.payload))
    : null

  for (const result of results) {
    const echoes = resOptRsltCh(bagEchoes, result)
    if (echoes.some((echo) => !echo?.uid)) {
      continue
    }

    const scored = execution ? scoreOptRow(execution, result) : { damage: result.damage, stats: null }
    finalized.push({
      damage: scored.damage,
      uids: echoes.map((echo) => echo?.uid ?? ''),
      stats: scored.stats,
    })

    if (finalized.length >= maxItems) {
      break
    }
  }

  return finalized.sort(byDamage)
}

export function matOptRsltsF(
  uidByIndex: readonly string[],
  results: readonly OptRawResult[],
  options: {
    payload?: PrepOptPay | null
    limit?: number
  } = {},
): OptFinalResult[] {
  if (
    options.payload?.mode === 'theoryTarget' ||
    options.payload?.mode === 'theoryRotation'
  ) {
    return matThryRslts(
        options.payload,
        results,
        options.limit,
    )
  }

  const finalized: OptResultEntry[] = []
  const maxItems = Math.max(1, Math.floor((options.limit ?? results.length) || 1))
  const execution = options.payload
    ? (options.payload.mode === 'rotation'
      ? packRotation(options.payload)
      : packTargetSkill(options.payload))
    : null

  for (const result of results) {
    if ('ids' in result) {
      continue
    }

    const uids = [
      uidByIndex[result.i0] ?? '',
      uidByIndex[result.i1] ?? '',
      uidByIndex[result.i2] ?? '',
      uidByIndex[result.i3] ?? '',
      uidByIndex[result.i4] ?? '',
    ]

    if (uids.some((uid) => !uid)) {
      continue
    }

    const scored = execution ? scoreOptRow(execution, result) : { damage: result.damage, stats: null }
    finalized.push({
      damage: scored.damage,
      uids,
      stats: scored.stats,
    })

    if (finalized.length >= maxItems) {
      break
    }
  }

  return finalized.sort(byDamage)
}

// compute the stat line for one raw theory result without expanding echoes.
export function evalThryRsltS(
    payload: ThryPay,
    result: OptRawResult,
): OptResultStats | null {
  if ('ids' in result) {
    return result.stats
  }

  const execution = getThryXct(payload)
  return execution.mode === 'rotation' ? scoreRotRow(execution, result, false).stats : scoreThryRow(execution, result).stats
}

// one theory bag row rescored on the cpu, as scoreOptRow does for inventory
// rows, with the winning weapon from search so damage and stats match it
function scoreThryRow(
  execution: ThryXct,
  result: OptBagResult,
): { damage: number; stats: OptResultStats | null } {
  const weaponIdx = result.weapon ?? -1
  if (execution.mode === 'rotation') return scoreRotRow(execution, result)

  const overlays = execution.weaponOverlays
  const weaponCtx = weaponIdx >= 0 && overlays && (execution.weaponCount ?? 0) > weaponIdx
      ? composeOneWeaponContext(execution.context, overlays, weaponIdx)
      : undefined
  const evaluated = evalOptBagEv(execution, result, weaponCtx)
  return { damage: evaluated?.damage ?? result.damage, stats: evaluated?.stats ?? null }
}

// materialize compact theory rows only after ranking has already happened
// this keeps the future search loop free of full echo object allocation.
export function matThryRslts(
    payload: ThryPay,
    results: readonly OptRawResult[],
    limit?: number,
): TheoryResult[] {
  const finalized: TheoryResult[] = []
  const maxItems = Math.max(1, Math.floor((limit ?? results.length) || 1))
  const execution = getThryXct(payload)

  for (const result of results) {
    const echoes = matThryRsltCh(payload, result)
    if (!echoes) {
      continue
    }

    // map the best-weapon index (bag results only) back to its catalog id.
    const weaponIdx = 'ids' in result ? -1 : (result.weapon ?? -1)
    const weaponId = weaponIdx >= 0
        ? (payload.weaponIds?.[weaponIdx] ?? null)
        : null

    const scored = 'ids' in result ? result : scoreThryRow(execution, result)
    finalized.push({
      damage: scored.damage,
      uids: echoes.map((echo) => echo.uid),
      echoes,
      stats: scored.stats,
      weaponId,
    })

    if (finalized.length >= maxItems) {
      break
    }
  }

  return finalized.sort((left, right) => right.damage - left.damage)
}

export function evalPrepOptB(
  payload: PrepOptPay,
  mainIndex: number,
): { damage: number; stats: OptResultStats | null } | null {
  if (payload.mode === 'theoryTarget' || payload.mode === 'theoryRotation') {
    return null
  }

  const comboIds = mkSqntCmbIds(payload.costs.length)
  if (comboIds.length === 0 || mainIndex < 0 || mainIndex >= comboIds.length) {
    return null
  }

  if (payload.mode === 'rotation') {
    const packed = packRotation(payload)
    return { damage: materializePortableDamage(packed, comboIds, mainIndex), stats: materializePortableStats(packed, comboIds, mainIndex) }
  }

  const execution = packTargetSkill(payload)
  const evaluated = evalTarget({
    context: execution.context,
    stats: execution.stats,
    setConstLut: execution.setConstLut,
    mainEchoBuffs: execution.mainEchoBuffs,
    sets: execution.sets,
    kinds: execution.kinds,
    comboIds,
    mainIndex,
  })

  return evaluated
    ? {
        damage: evaluated.damage,
        stats: evaluated.stats,
      }
    : null
}

export function compactTheoryResults(payload: ThryPay, results: readonly OptRawResult[], limit = payload.resultsLimit): import('../types').CompactTheoryResult[] {
  const compact = theoryResultCompactor(payload)
  const execution = getThryXct(payload)
  const finalized: import('../types').CompactTheoryResult[] = []
  for (const result of results) {
    const entry = compact(result)
    if (!entry) continue
    const weapon = 'weapon' in result ? result.weapon ?? -1 : -1
    const scored = 'ids' in result ? result : scoreThryRow(execution, result)
    finalized.push({ ...entry, damage: scored.damage, stats: scored.stats, weaponId: payload.weaponIds?.[weapon] ?? null })
    if (finalized.length >= limit) break
  }
  return finalized.sort((left, right) => right.damage - left.damage)
}
