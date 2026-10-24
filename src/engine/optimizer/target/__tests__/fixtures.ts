/*
  Author: Runor Ewhro
  description: builds deterministic mixed inventories and compiled target
               payloads shared by target-scorer invariant tests.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { listChsByCos } from '@/data/catalog/echoCatalogService'
import { listResSds } from '@/data/catalog/resonatorSeedService'
import { makeEnemy, makeOptSets, makeResRuntime } from '@/engine/runtime/defaults'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { runResSmlt } from '@/engine/pipeline'
import { compOptPay } from '@/engine/optimizer/compiler'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario'
import type { OptSets } from '@/domain/entities/optimizer'
import type { PrepTargetSkill } from '@/engine/optimizer/types'
import type { SkillDef } from '@/domain/entities/stats'

function rng(seed: number) {
  return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
}

const SUBS = ['critRate', 'critDmg', 'atkPercent', 'atkFlat', 'energyRegen', 'hpPercent', 'hpFlat', 'defPercent',
  'basicAtk', 'heavyAtk', 'resonanceSkill', 'resonanceLiberation']
const MAIN: Record<number, string[]> = {
  4: ['critRate', 'critDmg', 'atkPercent', 'hpPercent', 'defPercent'],
  3: ['atkPercent', 'energyRegen', 'aero', 'spectro', 'fusion', 'glacio', 'havoc', 'electro', 'hpPercent'],
  1: ['atkPercent', 'hpPercent', 'defPercent'],
}

// a small mixed inventory with repeated echo ids, so kind dedupe is exercised
export function inventory(seed: number, size: number): EchoInstance[] {
  const rand = rng(seed), pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)]!
  return Array.from({ length: size }, (_, index) => {
    const cost = pick([4, 3, 3, 1, 1])
    const def = pick(listChsByCos(cost).slice(0, 6))
    const substats: Record<string, number> = {}
    while (Object.keys(substats).length < 4) substats[pick(SUBS)] = +(2 + rand() * 9).toFixed(1)
    return {
      uid: `e${index}`, id: def.id, set: pick(def.sets.length ? def.sets : [0]), mainEcho: false,
      mainStats: { primary: { key: pick(MAIN[cost]!), value: cost === 4 ? 22 : cost === 3 ? 30 : 18 },
        secondary: { key: 'atkFlat', value: cost === 4 ? 150 : cost === 3 ? 100 : 18 } },
      substats,
    } as EchoInstance
  })
}

export function payloadFor(resonatorId: string, invChs: EchoInstance[], lock: string | null, extra: Partial<OptSets> = {},
  skillFilter: (skill: SkillDef) => boolean = () => true) {
  const seed = listResSds().find((entry) => entry.id === resonatorId)!
  const runtime = makeResRuntime(seed)
  const enemy = makeEnemy()
  const sim = runResSmlt(runtime, seed, enemy, makeRuntimeMap(runtime))
  const skill = sim.allSkills.filter((entry) => entry.aggregationType === 'damage' && entry.avg > 0 && skillFilter(entry.skill))
    .sort((a, b) => b.avg - a.avg)[0]!.skill
  const settings = { ...makeOptSets(), enableGpu: false, targetSkillId: skill.id, lockedMainEchoId: lock, ...extra }
  return compOptPay({
    scenarioId: combatScenarioId('optimizer:test'), memberId: teamMemberId(seed.id), resonatorId: seed.id,
    runtime, settings, invChs, enemyProfile: enemy,
  }) as PrepTargetSkill
}
