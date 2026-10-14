/*
  Author: Runor Ewhro
  description: tests loading saved rotation steps into a working context.
*/

import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/application/state/store.ts'
import { consumePersist } from '@/application/persistence/storage.ts'
import { ensureResonatorData } from '@/data/gameData'
import { listResSds } from '@/data/catalog/resonatorSeedService.ts'
import { contextScenarioMember } from '@/domain/entities/combatScenario.ts'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { loadRotationScenario } from '../useLoadRotation.ts'

describe('saved rotation loading', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumePersist()
  })

  it('opens the saved resonator context and replaces only its steps', async () => {
    const initialId = contextScenarioMember(selectedCombatScenario(useAppStore.getState().combat)).resonatorId
    const otherSeed = listResSds().find((seed) => seed.id !== initialId)!
    await ensureResonatorData([otherSeed.id])
    useAppStore.getState().swRes(otherSeed.id)

    const before = structuredClone(selectedCombatScenario(useAppStore.getState().combat))
    const saved = structuredClone(before)
    const step: RotationNode = {
      id: 'saved-context-step',
      type: 'feature',
      featureId: 'saved-feature',
      resonatorId: otherSeed.id,
      enabled: true,
      multiplier: 1,
    }
    saved.program.program = [step]
    saved.target.level += 10
    saved.team.members[0].progression.level = 42
    useAppStore.getState().swRes(initialId)

    await loadRotationScenario(saved, 'rotation')

    const after = selectedCombatScenario(useAppStore.getState().combat)
    expect(contextScenarioMember(after).resonatorId).toBe(otherSeed.id)
    expect(after.program.program).toEqual([step])
    expect(after.team).toEqual(before.team)
    expect(after.target).toEqual(before.target)
    expect(after.environment).toEqual(before.environment)
  })
})
