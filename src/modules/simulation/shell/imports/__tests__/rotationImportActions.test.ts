/*
  Author: Runor Ewhro
  description: verifies each post-parse rotation import choice changes only its promised state.
*/

import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/application/state/store'
import type { NormalizedImportedRotation } from '@/application/imports/rotationPayload.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { contextScenarioMember } from '@/domain/entities/combatScenario.ts'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { consumePersist } from '@/application/persistence/storage.ts'
import { applyRotationImport } from '../rotationImport.ts'

function entry(name = 'Imported'): NormalizedImportedRotation {
  const scenario = structuredClone(selectedCombatScenario(useAppStore.getState().combat))
  const member = contextScenarioMember(scenario)
  const node: RotationNode = {
    id: 'imported-step',
    type: 'feature',
    featureId: 'imported-feature',
    resonatorId: member.resonatorId,
    enabled: true,
    multiplier: 1,
  }
  scenario.program = { ...scenario.program, program: [node] }
  scenario.target = { ...scenario.target, level: scenario.target.level + 10 }
  scenario.team.members[0].progression.level = 42
  return { name, resName: member.resonatorId, scenario }
}

describe('post-parse rotation import actions', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumePersist()
  })

  it('loads only steps into the existing context without saving', async () => {
    const imported = entry()
    const before = structuredClone(selectedCombatScenario(useAppStore.getState().combat))
    const savedCount = useAppStore.getState().library.rotations.length

    await applyRotationImport([imported], { load: 'rotation', save: false })

    const after = selectedCombatScenario(useAppStore.getState().combat)
    expect(after.program.program).toEqual(imported.scenario.program.program)
    expect(after.program.program).not.toBe(imported.scenario.program.program)
    expect(after.target).toEqual(before.target)
    expect(after.team).toEqual(before.team)
    expect(after.environment).toEqual(before.environment)
    expect(useAppStore.getState().library.rotations).toHaveLength(savedCount)
  })

  it('loads the full build without adding a saved rotation', async () => {
    const imported = entry()
    const savedCount = useAppStore.getState().library.rotations.length

    await applyRotationImport([imported], { load: 'build', save: false })

    const after = selectedCombatScenario(useAppStore.getState().combat)
    expect(after.program.program).toEqual(imported.scenario.program.program)
    expect(after.target.level).toBe(imported.scenario.target.level)
    expect(contextScenarioMember(after).progression.level).toBe(42)
    expect(useAppStore.getState().library.rotations).toHaveLength(savedCount)
  })

  it('saves every received rotation without changing the working scenario', async () => {
    const entries = [entry('First'), entry('Second')]
    const before = structuredClone(selectedCombatScenario(useAppStore.getState().combat))
    const savedCount = useAppStore.getState().library.rotations.length

    await applyRotationImport(entries, { load: 'none', save: true })

    expect(selectedCombatScenario(useAppStore.getState().combat)).toEqual(before)
    expect(useAppStore.getState().library.rotations).toHaveLength(savedCount + 2)
  })

  it('loads the first received build and saves every received rotation when both are chosen', async () => {
    const entries = [entry('First'), entry('Second')]
    const savedCount = useAppStore.getState().library.rotations.length

    await applyRotationImport(entries, { load: 'build', save: true })

    expect(selectedCombatScenario(useAppStore.getState().combat).program.program)
      .toEqual(entries[0].scenario.program.program)
    expect(useAppStore.getState().library.rotations).toHaveLength(savedCount + 2)
  })
})
