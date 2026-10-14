/*
  Author: Runor Ewhro
  description: bounds optimizer result staging and constructs compact target
               execution payloads for worker jobs.
*/

import { packTargetCtx } from '@/engine/optimizer/context/pack'
import type { PckdOptXctnP, PrepTheoryRot, PrepTheoryTarget } from '@/engine/optimizer/types'

// bound both local result buffers and the merged heap independently of caller input.
const GPU_RESULT_LIMIT = 65536
const TGTGPUJOBVRS = 1
const GPU_COLLECT_MUL = 2

function clmpTgtGpuRs(resultsLimit: number, oversample: number): number {
  const baseLimit = Math.max(1, Math.floor(resultsLimit || 1))
  return Math.min(
      Math.max(Math.floor(baseLimit * oversample), baseLimit),
      GPU_RESULT_LIMIT,
  )
}

/** caps one gpu job at the requested top-k and the global allocation ceiling. */
export function resTgtGpuJob(resultsLimit: number, lowMem = false): number {
  return clmpTgtGpuRs(resultsLimit, lowMem ? 1 : TGTGPUJOBVRS)
}

/** lets the merged collector retain twice the requested top-k unless low-memory mode is active. */
export function resTgtGpuCll(resultsLimit: number, lowMem = false): number {
  return clmpTgtGpuRs(resultsLimit, lowMem ? 1 : GPU_COLLECT_MUL)
}

// five int32 values represent each combo, so halving the low-memory batch
// directly halves its largest remaining transient allocation.
export function bchSzFr(normal: number, lowMem: boolean): number {
  return lowMem ? Math.max(1, Math.floor(normal / 2)) : normal
}

export function mkThryXctPay(
    payload: PrepTheoryTarget | PrepTheoryRot,
): PckdOptXctnP {
  if (payload.mode === 'theoryRotation') {
    return {
      ...payload,
      mode: 'rotation',
    }
  }

  return {
    ...payload,
    mode: 'targetSkill',
    context: packTargetCtx({
      compiled: payload.compiled,
      skill: payload.skill,
      runtime: payload.runtime,
      comboN: payload.comboN,
      comboK: payload.comboK,
      comboCount: payload.totalCombos,
      comboBaseIndex: 0,
      lockEchoIdx: payload.lockMainCands[0] ?? -1,
      setRtMask: payload.setRtMask,
    }),
  }
}
