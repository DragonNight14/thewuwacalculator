/*
  Author: Runor Ewhro
  description: applies weapon selection and rank changes while resetting runtime state for the previous weapon.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { GenWpn } from '@/domain/entities/weapon.ts'
import { initWpnStts, maxWpnRt } from '@/engine/runtime/sourceStateInit.ts'
import { weaponStatsAt } from '@/modules/simulation/features/weapons/lib/weapon.ts'
import { clampNumber } from '@/shared/lib/number.ts'

export const WPN_RANK_MIN = 1
export const WPN_RANK_MAX = 5

/*
  selection sets weapon rank to one and preserves the slot level or uses the
  maximum level when requested. initWpnStts/maxWpnRt replace old weapon states.
*/
export function applyWpnSel(
  runtime: ResRuntime,
  weapon: GenWpn,
  options: { maxOnInit: boolean; level: number },
): ResRuntime {
  const nextLevel = options.maxOnInit ? 90 : options.level
  const stats = weaponStatsAt(weapon, nextLevel)
  const prevWpnId = runtime.build.weapon.id

  const nextRuntime: ResRuntime = {
    ...runtime,
    build: {
      ...runtime.build,
      weapon: {
        ...runtime.build.weapon,
        id: weapon.id,
        level: nextLevel,
        baseAtk: stats.atk,
        rank: WPN_RANK_MIN,
      },
    },
  }

  return options.maxOnInit
    ? maxWpnRt(nextRuntime, { targetRank: WPN_RANK_MIN, prevWpnId })
    : initWpnStts(nextRuntime, { weaponId: weapon.id, prevWpnId, maxed: false })
}

export function setWpnRank(runtime: ResRuntime, rank: number): ResRuntime {
  const nextRank = clampNumber(Math.round(rank), WPN_RANK_MIN, WPN_RANK_MAX)
  if (nextRank === runtime.build.weapon.rank) {
    return runtime
  }

  return {
    ...runtime,
    build: {
      ...runtime.build,
      weapon: { ...runtime.build.weapon, rank: nextRank },
    },
  }
}
