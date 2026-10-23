/*
  Author: Runor Ewhro
  description: builds static gpu payloads for target-skill optimizer runs and
               partitions target search space into per-job combo windows,
               including support for locked-main search variants.
*/

import type {
  TargetGpuState,
} from '@/engine/optimizer/workers/messages.ts'
import type { PrepOptShrdP, PrepTheoryTarget, PrepTargetSkill } from '@/engine/optimizer/types.ts'
import { packTargetSkill } from '@/engine/optimizer/payloads/targetPayload.ts'
import { mkCostLayout } from '@/engine/optimizer/combos/costLayout.ts'
import { MAX_ECHO_COST } from '@/engine/search/layout/constants.ts'

export interface TgtJobSpec {
  // starting combo rank for this job window
  comboStart: number

  // number of combos to evaluate from comboStart
  comboCount: number

  // locked main echo index for this job, or -1 when main is unrestricted
  lockMainIdx: number
}

// a stable hash of typed-array payloads identifies reusable gpu state by content.
function hashTypdRry(view: ArrayBufferView): string {
  const bytes = new Uint8Array(
      view.buffer,
      view.byteOffset,
      view.byteLength,
  )

  // fnv-1a style rolling hash seeded with byte length
  let hash = (2166136261 ^ view.byteLength) >>> 0

  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index] ?? 0
    hash = Math.imul(hash, 16777619) >>> 0
  }

  return `${view.byteLength.toString(16)}:${hash.toString(16)}`
}

// shaders read certain small encoded buffers as float arrays,
// so promote u8 storage to f32 here once during static payload construction
function toGpuFltRry(values: Uint8Array): Float32Array {
  const out = new Float32Array(values.length)

  for (let index = 0; index < values.length; index += 1) {
    out[index] = values[index] ?? 0
  }

  return out
}

// shaders read kind ids as signed integers, so widen u16 ids into i32
function toGpuIntRry(values: Uint16Array): Int32Array {
  const out = new Int32Array(values.length)

  for (let index = 0; index < values.length; index += 1) {
    out[index] = values[index] ?? 0
  }

  return out
}

// build a deterministic cache key for the target gpu static state
// every load-bearing binary blob is included so mismatched payloads cannot collide
export function mkTgtGpuSttc(payload: TargetGpuState): string {
  return [
    `memory:${payload.lowMmryMode ? 1 : 0}`,
    `n:${payload.comboN}`,
    `k:${payload.comboK}`,
    `t:${payload.totalCombos}`,
    `l:${payload.lockMainReq ? 1 : 0}`,
    `ctx:${hashTypdRry(payload.context)}`,
    `stats:${hashTypdRry(payload.stats)}`,
    `lut:${hashTypdRry(payload.setConstLut)}`,
    `costs:${hashTypdRry(payload.costs)}`,
    `constraints:${hashTypdRry(payload.constraints)}`,
    `main:${hashTypdRry(payload.mainEchoBuffs)}`,
    `sets:${hashTypdRry(payload.sets)}`,
    `kinds:${hashTypdRry(payload.kinds)}`,
    `index:${hashTypdRry(payload.comboIndexMap)}`,
    `binom:${hashTypdRry(payload.comboBinom)}`,
    `locked:${hashTypdRry(payload.lockMainCands)}`,
    `wpn:${payload.weaponOverlays ? hashTypdRry(payload.weaponOverlays) : '0'}`,
  ].join('|')
}

// convert a prepared target run to the gpu initialization payload.
// convert typed arrays to the gpu buffer format.
export function makeTargetGpu(
    prepared: PrepTargetSkill | PrepTheoryTarget,
): TargetGpuState {
  const payload = packTargetSkill(prepared)

  return {
    context: payload.context,
    lowMmryMode: prepared.lowMmryMode,
    stats: payload.stats,
    setConstLut: payload.setConstLut,
    costs: toGpuFltRry(payload.costs),
    constraints: payload.constraints,
    mainEchoBuffs: payload.mainEchoBuffs,
    sets: toGpuFltRry(payload.sets),
    kinds: toGpuIntRry(payload.kinds),
    comboN: payload.comboN,
    comboK: payload.comboK,
    totalCombos: payload.totalCombos,
    comboIndexMap: payload.comboIndexMap,
    comboBinom: payload.comboBinom,
    lockMainReq: payload.lockMainReq,
    lockMainCands: payload.lockMainCands,
    weaponOverlays: payload.weaponOverlays,
    weaponCount: payload.weaponCount,
  }
}

// split the full target-search space into fixed-size jobs
// if main echo is locked, we generate one full combo window series per allowed locked index;
// otherwise we generate a single unrestricted series using lockedMainIndex = -1
export function mkTgtJobs(
    payload: Pick<
        PrepOptShrdP,
        'totalCombos' | 'lockMainReq' | 'lockMainCands'
    >,
    combosPerJob: number,
    lckdMainNdcs: ReadonlyArray<number> | Int32Array = payload.lockMainReq
        ? payload.lockMainCands
        : [-1],
): TgtJobSpec[] {
  return [...generateGpuJobs(payload, () => combosPerJob, lckdMainNdcs)]
}

export function* generateGpuJobs(
  payload: Pick<PrepOptShrdP, 'totalCombos' | 'lockMainReq' | 'lockMainCands'>,
  batchSize: () => number,
  lckdMainNdcs: ReadonlyArray<number> | Int32Array = payload.lockMainReq ? payload.lockMainCands : [-1],
  totalFor: (lockedMainIndex: number) => number = () => payload.totalCombos,
): Generator<TgtJobSpec> {
  for (const lockedMainIndex of lckdMainNdcs) {
    const total = totalFor(lockedMainIndex)
    let comboStart = 0
    while (comboStart < total) {
      const comboCount = Math.min(Math.max(1, Math.floor(batchSize())), total - comboStart)
      yield {
        comboStart,
        comboCount,
        lockMainIdx: lockedMainIndex,
      }
      comboStart += comboCount
    }
  }
}

// the target gpu search enumerates only cost-legal combos (combos/costLayout.ts),
// so its job windows and progress span this count per locked main.
export function costLegalTotals(
    payload: Pick<PrepTargetSkill, 'costs' | 'comboK' | 'comboBinom' | 'lockMainReq' | 'lockMainCands'>,
): Map<number, number> {
  const totals = new Map<number, number>()
  for (const lockedIndex of payload.lockMainReq ? payload.lockMainCands : [-1]) {
    if (totals.has(lockedIndex)) continue
    totals.set(lockedIndex, mkCostLayout(payload.costs, payload.comboK, lockedIndex, MAX_ECHO_COST, payload.comboBinom).total)
  }
  return totals
}
