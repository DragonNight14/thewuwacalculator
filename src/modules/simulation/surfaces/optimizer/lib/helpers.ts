/*
  Author: Runor Ewhro
  description: resolves optimizer slot runtimes, loadout summaries, target
               eligibility, stat-filter keys, and weapon-state replacements.
*/

import { getSntSetIco } from '@/data/gameData/catalog/sonataSets.ts'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects.ts'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import { getEchoById } from '@/data/catalog/echoCatalogService.ts'
import { makeTeamMember } from '@/engine/runtime/defaults.ts'
import { materializeLegacyTeamMember } from '@/engine/runtime/runtimeMaterialization.ts'
import { seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import type { OptDisplayRow, OptDsplSetEn } from '../Row.tsx'
import type { EchoPlan } from './teammateEchoPlan.ts'

export type PrvwTgt =
  | { kind: 'base' }
  | { kind: 'result'; index: number }

type OpSlot = 'active' | 0 | 1
export type OpEchoTarget = 'filter' | 0 | 1

// the shared idle progress object gives the stage a stable reset value.
export function mkMptyPrgr(): import('@/engine/optimizer/types').OptPrgr {
  return {
    progress: 0,
    elapsedMs: 0,
    remainingMs: Infinity,
    processed: 0,
    speed: 0,
    total: 0,
    phase: 'evaluating',
    discovered: 0,
  }
}

// translate ui-facing stat filter keys into echo stat keys.
export function mapMainStatF(filterKey: string, selectedBonus: string | null): string | null {
  if (filterKey === 'atk%') return 'atkPercent'
  if (filterKey === 'hp%') return 'hpPercent'
  if (filterKey === 'def%') return 'defPercent'
  if (filterKey === 'er') return 'energyRegen'
  if (filterKey === 'cr') return 'critRate'
  if (filterKey === 'cd') return 'critDmg'
  if (filterKey === 'healing') return 'healingBonus'
  if (filterKey === 'bonus') return selectedBonus
  return null
}

// derive the compact preview summary shown in result rows and preview cards.
export function smmrEchoLdt(
  echoes: Array<EchoInstance | null>,
): Pick<OptDisplayRow, 'costs' | 'sets' | 'mainEchoIcon'> {
  const setCounts = new Map<number, number>()
  // preserve each echo's cost in the loadout.
  const costs: number[] = []

  for (const echo of echoes) {
    if (!echo) {
      continue
    }

    setCounts.set(echo.set, (setCounts.get(echo.set) ?? 0) + 1)
    const echoCost = getEchoById(echo.id)?.cost ?? 0
    if (echoCost > 0) {
      costs.push(echoCost)
    }
  }

  costs.sort((a, b) => b - a)

  const sets: OptDsplSetEn[] = Array.from(setCounts.entries())
    .flatMap(([id, count]) => {
      const setDef = getEchoSetDe(id)
      if (!setDef) {
        return []
      }

      const cmpsCnt =
        setDef.setMax === 1
          ? count >= 1 ? 1 : null
          : setDef.setMax === 3
            ? count >= 3 ? 3 : null
            : count >= 5
              ? 5
              : count >= 2
                ? 2
                : null

      if (cmpsCnt == null) {
        return []
      }

      return [{
        id,
        count: cmpsCnt,
        icon: getSntSetIco(id),
      }]
    })
    .sort((left, right) => right.count - left.count || left.id - right.id)

  return {
    costs: costs.length > 0 ? costs : null,
    sets,
    mainEchoIcon: echoes[0] ? getEchoById(echoes[0].id)?.icon ?? null : null,
  }
}

// creates an empty echo plan
export function mkMptyEchoPl(): [EchoPlan | null, EchoPlan | null] {
  return [null, null]
}

// normalize loadouts to the fixed five-slot shape used by runtime consumers.
export function normEchoLdt(
  echoes: ReadonlyArray<EchoInstance | null | undefined>,
): Array<EchoInstance | null> {
  const out: Array<EchoInstance | null> = [null, null, null, null, null]
  for (let index = 0; index < out.length; index += 1) {
    out[index] = echoes[index] ?? null
  }
  return out
}

// resolve an optimizer slot from canonical participants, with legacy compact
// teammate materialization retained only for detached callers.
export function makeOpSlot(
    runtime: ResRuntime,
    slot: OpSlot,
    runtimesById: Readonly<Record<string, ResRuntime>> = {},
): ResRuntime | null {
  if (slot === 'active') {
    return runtime
  }

  const memberId = runtime.build.team[slot + 1]
  if (!memberId) {
    return null
  }

  const participant = runtimesById[memberId]
  if (participant) {
    return participant
  }

  const seed = seedRsntById[memberId] ?? null
  if (!seed) {
    return null
  }

  const compactRuntime = runtime.teamRuntimes[slot]
  const resolvedRuntime = compactRuntime?.id === memberId
    ? compactRuntime
    : makeTeamMember(seed)

  return materializeLegacyTeamMember(
    seed,
    resolvedRuntime,
    runtime.state.controls,
    runtime.state.combat,
    runtime.build.team,
  )
}
