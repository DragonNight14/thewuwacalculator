/*
  Author: Runor Ewhro
  description: maximizes one resonator's state, with an effects-only option for
               imports that supply progression values.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import { isResRtMaxed, maxResRt } from '@/engine/gameData/resonatorMax'
import { maxEchoStts, maxWpnRt, maxWpnStts } from '@/engine/runtime/sourceStateInit'

export function maxRuntime(runtime: ResRuntime, targetSequence = runtime.base.sequence): ResRuntime {
  const resonator = maxResRt(runtime, getResDtlsBy()[runtime.id], { targetSequence })
  const weapon = maxWpnRt(resonator, { targetRank: runtime.build.weapon.rank })
  return maxEchoStts(weapon)
}

export function maxRuntimeEffects(runtime: ResRuntime): ResRuntime {
  const resonator = maxResRt(runtime, getResDtlsBy()[runtime.id], {
    targetSequence: runtime.base.sequence,
  })
  const withCurrentProgression = {
    ...runtime,
    state: { ...runtime.state, controls: resonator.state.controls },
  }
  return maxEchoStts(maxWpnStts(withCurrentProgression))
}

export function isRuntimeMaxed(runtime: ResRuntime, preparedMax: ResRuntime): boolean {
  const controls = runtime.state.controls
  const maxControls = preparedMax.state.controls
  return runtime.id === preparedMax.id
    && isResRtMaxed(runtime, getResDtlsBy()[runtime.id], preparedMax)
    && runtime.build.weapon.level === preparedMax.build.weapon.level
    && runtime.build.weapon.baseAtk === preparedMax.build.weapon.baseAtk
    && Object.keys(controls).length === Object.keys(maxControls).length
    && Object.entries(maxControls).every(([key, value]) => Object.is(controls[key], value))
}
