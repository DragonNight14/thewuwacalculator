/*
  Author: Runor Ewhro
  description: verifies the atomic store boundaries used by transient
               configuration surfaces.
*/

import { beforeEach, describe, expect, it } from 'vitest'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { useAppStore } from '@/application/state/store.ts'
import { consumePersist } from '@/application/persistence/storage.ts'
import { listResSds } from '@/data/catalog/resonatorSeedService.ts'
import { makeResProfile, makeScenarioMemberFromProfile } from '@/engine/runtime/defaults.ts'
import { insertScenarioTeamMember, removeScenarioTeamMember, replaceScenarioTeamMember } from '@/engine/runtime/scenarioMembers.ts'
import { applyRuntimeToSimulation, materializeScenarioRuntime } from '@/engine/runtime/runtimeAdapters.ts'
import { makeEmptyManualBuffs } from '@/engine/runtime/scenarioEnvironment.ts'
import { parseScenarioEnvironment } from '@/engine/runtime/schema.ts'
import { createConfigurationTransaction } from '@/shared/ui/useConfigurationSession.ts'

describe('configuration commit boundaries', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumePersist()
  })

  it('publishes a scenario configuration as one history transaction', () => {
    const before = selectedCombatScenario(useAppStore.getState().combat)
    const historyCount = useAppStore.getState().history.past.length

    useAppStore.getState().commitScenarioConfig(before.id, (scenario) => ({
      ...scenario,
      target: { ...scenario.target, level: scenario.target.level + 7 },
      environment: {
        ...scenario.environment,
        targetModifiers: {
          ...scenario.environment.targetModifiers,
          defenseReduction: 18,
        },
      },
    }))

    const after = selectedCombatScenario(useAppStore.getState().combat)
    expect(after.revision).toBe(before.revision + 1)
    expect(after.target.level).toBe(before.target.level + 7)
    expect(after.environment.targetModifiers.defenseReduction).toBe(18)
    expect(useAppStore.getState().history.past).toHaveLength(historyCount + 1)
    expect(useAppStore.getState().canUndo()).toBe(true)
    expect(consumePersist()).toEqual(['combat.workspace'])
  })

  it('publishes several appearance edits as one history transaction', () => {
    const before = useAppStore.getState()
    const historyCount = before.history.past.length

    before.commitAppearanceConfig((ui) => ({
      ...ui,
      theme: 'background',
      themePreference: 'background',
      blurMode: !ui.blurMode,
    }))

    const after = useAppStore.getState()
    expect(after.ui.theme).toBe('background')
    expect(after.ui.themePreference).toBe('background')
    expect(after.ui.blurMode).toBe(!before.ui.blurMode)
    expect(after.history.past).toHaveLength(historyCount + 1)
    expect(consumePersist()).toEqual(['ui.appearance'])
  })

  it('edits, removes, and clears the source row of an inherited manual modifier', () => {
    const initial = selectedCombatScenario(useAppStore.getState().combat)
    const member = initial.team.members[0]
    const teammateSeed = listResSds().find((seed) => seed.id !== member.resonatorId)!
    const teammate = makeScenarioMemberFromProfile(makeResProfile(teammateSeed))
    const teamScenario = insertScenarioTeamMember(initial, 1, teammate)
    const shared = makeEmptyManualBuffs()
    shared.quick.atk.percent = 10
    shared.modifiers.push({ id: 'shared-mod', enabled: true, scope: 'topStat', stat: 'critRate', value: 10 })
    const scenario = {
      ...teamScenario,
      environment: {
        ...teamScenario.environment,
        manualEffects: [
          ...teamScenario.environment.manualEffects,
          { id: 'shared', enabled: true, selector: { kind: 'all' as const }, buffs: shared },
        ],
      },
    }
    const runtime = materializeScenarioRuntime(scenario, member.resonatorId)!
    expect(runtime.state.manualBuffs.modifiers.map((modifier) => modifier.id)).toContain('shared-mod')
    const edited = applyRuntimeToSimulation(scenario, member.resonatorId, {
      ...runtime,
      state: { ...runtime.state, manualBuffs: {
        ...runtime.state.manualBuffs,
        modifiers: runtime.state.manualBuffs.modifiers.map((modifier) =>
          modifier.id === 'shared-mod' ? { ...modifier, value: 14 } : modifier),
      } },
    }).scenario
    const afterEdit = materializeScenarioRuntime(edited, member.resonatorId)!
    expect(afterEdit.state.manualBuffs.modifiers).toEqual([
      { id: 'shared-mod', enabled: true, scope: 'topStat', stat: 'critRate', value: 14 },
    ])
    expect(materializeScenarioRuntime(edited, teammate.resonatorId)?.state.manualBuffs.modifiers[0]?.value).toBe(10)
    expect(edited.environment.manualEffects.find((effect) => effect.id === 'shared')?.excludedMemberIds).toEqual([member.id])
    expect(parseScenarioEnvironment(edited.environment).success).toBe(true)
    const removed = applyRuntimeToSimulation(edited, member.resonatorId, {
      ...afterEdit,
      state: { ...afterEdit.state, manualBuffs: {
        ...afterEdit.state.manualBuffs,
        modifiers: [],
      } },
    }).scenario
    expect(materializeScenarioRuntime(removed, member.resonatorId)?.state.manualBuffs.modifiers).toEqual([])
    expect(removed.environment.manualEffects.find((effect) => effect.id === 'shared')?.buffs.modifiers).toEqual(shared.modifiers)
    expect(materializeScenarioRuntime(removed, teammate.resonatorId)?.state.manualBuffs.modifiers[0]?.value).toBe(10)
    const cleared = applyRuntimeToSimulation(edited, member.resonatorId, {
      ...afterEdit,
      state: { ...afterEdit.state, manualBuffs: makeEmptyManualBuffs() },
    }).scenario
    expect(materializeScenarioRuntime(cleared, member.resonatorId)?.state.manualBuffs.modifiers).toEqual([])
    expect(materializeScenarioRuntime(cleared, member.resonatorId)?.state.manualBuffs.quick.atk.percent).toBe(0)
    expect(materializeScenarioRuntime(cleared, teammate.resonatorId)?.state.manualBuffs.quick.atk.percent).toBe(10)
  })

  it('applies common member edits without replacing unrelated scenario payloads', () => {
    const scenario = selectedCombatScenario(useAppStore.getState().combat)
    const resonatorId = scenario.team.members[0].resonatorId
    const previous = materializeScenarioRuntime(scenario, resonatorId)!
    const edits = [
      { ...previous, base: { ...previous.base, level: previous.base.level + 1 } },
      { ...previous, state: {
        ...previous.state,
        controls: { ...previous.state.controls, 'test:toggle': true },
      } },
      { ...previous, build: {
        ...previous.build,
        weapon: { ...previous.build.weapon, rank: previous.build.weapon.rank + 1 },
      } },
      { ...previous, build: {
        ...previous.build,
        echoes: [...previous.build.echoes],
      } },
    ]

    for (const edited of edits) {
      const expected = applyRuntimeToSimulation(scenario, resonatorId, edited).scenario
      const actual = applyRuntimeToSimulation(scenario, resonatorId, edited, previous).scenario
      expect(actual).toEqual(expected)
      expect(actual.environment).toBe(scenario.environment)
      expect(actual.program).toBe(scenario.program)
      expect(actual.team.members[0].local.setConditionals)
        .toBe(scenario.team.members[0].local.setConditionals)
    }
  })

  it('keeps nested teammate replacements and subsequent edits in the same draft', () => {
    const initial = selectedCombatScenario(useAppStore.getState().combat)
    const seeds = listResSds().filter((seed) => seed.id !== initial.team.members[0].resonatorId)
    const original = makeScenarioMemberFromProfile(makeResProfile(seeds[0]))
    useAppStore.getState().insertScenarioMember(initial.id, 1, original)
    useAppStore.getState().setScenarioRouting(initial.id, initial.team.members[0].id, 'support', original.id)
    consumePersist()
    const before = selectedCombatScenario(useAppStore.getState().combat)
    const historyCount = useAppStore.getState().history.past.length
    const transaction = createConfigurationTransaction(before, (reducer) => {
      useAppStore.getState().commitScenarioConfig(before.id, reducer)
    })
    const replacement = makeScenarioMemberFromProfile(makeResProfile(seeds[1]))
    transaction.update((scenario) => replaceScenarioTeamMember(scenario, original.id, replacement))

    expect(materializeScenarioRuntime(transaction.read(), replacement.resonatorId)?.id)
      .toBe(replacement.resonatorId)
    transaction.update((scenario) => {
      const runtime = materializeScenarioRuntime(scenario, replacement.resonatorId)!
      return applyRuntimeToSimulation(scenario, replacement.resonatorId, {
        ...runtime,
        base: { ...runtime.base, level: 42 },
      }).scenario
    })
    expect(selectedCombatScenario(useAppStore.getState().combat)).toBe(before)
    expect(consumePersist()).toEqual([])
    transaction.finish()
    transaction.finish()

    const after = selectedCombatScenario(useAppStore.getState().combat)
    expect(after.team.members[1]?.id).toBe(original.id)
    expect(after.team.members[1]?.resonatorId).toBe(replacement.resonatorId)
    expect(after.team.members[1]?.progression.level).toBe(42)
    expect(after.environment.routing.bySourceMemberId[initial.team.members[0].id].support).toBe(original.id)
    expect(after.revision).toBe(before.revision + 1)
    expect(useAppStore.getState().history.past).toHaveLength(historyCount + 1)
    expect(consumePersist()).toEqual(['combat.workspace'])
  })

  it('shares insertion and removal invariants between drafts and canonical commands', () => {
    const before = selectedCombatScenario(useAppStore.getState().combat)
    const seed = listResSds().find((candidate) => candidate.id !== before.team.members[0].resonatorId)!
    const member = makeScenarioMemberFromProfile(makeResProfile(seed))
    const insertedDraft = insertScenarioTeamMember(before, 1, member)
    useAppStore.getState().insertScenarioMember(before.id, 1, member)
    expect(selectedCombatScenario(useAppStore.getState().combat)).toEqual(insertedDraft)
    expect(before.team.members).toHaveLength(1)

    const removedDraft = removeScenarioTeamMember(insertedDraft, member.id)
    useAppStore.getState().removeScenarioMember(before.id, member.id)
    expect(selectedCombatScenario(useAppStore.getState().combat)).toEqual(removedDraft)
    expect(removedDraft.environment.routing.bySourceMemberId[member.id]).toBeUndefined()
    expect(removedDraft.environment.manualEffects).toEqual(before.environment.manualEffects)
    expect(replaceScenarioTeamMember(insertedDraft, member.id, before.team.members[0])).toBe(insertedDraft)
  })
})
