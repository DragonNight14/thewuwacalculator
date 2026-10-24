/*
  Author: Runor Ewhro
  description: verifies saved and live rotation sources bind to the selected
               scenario team, member, encounter state, and game-data lease.
*/

import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { makeResProfile, makeScenarioFromProfiles } from '@/engine/runtime/defaults.ts'
import { combatScenarioId, makeScenarioTeam } from '@/domain/entities/combatScenario.ts'
import { projectScenarioRuntimes } from '@/engine/runtime/scenarioRuntime.ts'
import { prepareResSimulation } from '@/engine/pipeline/index.ts'
import { captureRotationDamagePlan } from '@/engine/rotation/damagePlan.ts'
import { listRotationDamageSources, resolveRotationDamageSource, rotationDamageContext } from '@/engine/rotation/damageSource.ts'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import { ensureResonatorData, hasResonatorData, holdResonatorData, initGameData } from '@/data/gameData'
import { getDefaultRotation } from '@/data/catalog/gameDataService.ts'

describe('rotation damage sources', () => {
  it('restores another live scenario\'s full team damage after loading its off-team kits', async () => {
    // scoped bundle fetches inspect Response.ok, unlike full initialization.
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => ({
      ok: true,
      json: async () => JSON.parse(await readFile(`public${String(input)}`, 'utf8')),
    } as Response))
    let release: (() => void) | undefined
    try {
      await initGameData({ mode: 'beta', resonatorIds: ['1410', '1509', '1209'] })
      const iuno = getResSeedBy('1410')!
      const lynae = getResSeedBy('1509')!
      const mornye = getResSeedBy('1209')!
      const current = makeScenarioFromProfiles({ [iuno.id]: makeResProfile(iuno, { maxed: true }) }, null, 0, iuno.id)
      const live = makeScenarioFromProfiles({ [lynae.id]: makeResProfile(lynae, { maxed: true }) }, null, 0, lynae.id)
      const support = makeScenarioFromProfiles({ [mornye.id]: makeResProfile(mornye, { maxed: true }) }, null, 0, mornye.id)
      live.id = combatScenarioId('other-live-scenario')
      live.team = makeScenarioTeam([
        live.team.members[0],
        structuredClone(current.team.members[0]),
        support.team.members[0],
      ])
      live.program.program = structuredClone([
        ...getDefaultRotation(lynae.id)!.items,
        ...getDefaultRotation(iuno.id)!.items,
        ...getDefaultRotation(mornye.id)!.items,
      ])
      live.environment.targetModifiers.damageTakenAmplification = 0.25
      const source = resolveRotationDamageSource(`scenario:${live.id}`, current, [], iuno.id, [live])!
      const runtime = projectScenarioRuntimes(current).subjectRuntime
      const score = () => {
        const bound = rotationDamageContext(source, current, runtime)!
        const plan = captureRotationDamagePlan({
          runtime: bound.runtime, seed: getResSeedBy(iuno.id)!, enemy: current.target,
          items: source.items, runtimesById: bound.runtimesById,
          selectedTargets: bound.selectedTargets, combatSetup: bound.combatSetup,
        })
        return plan.fixedTeamDamage + plan.cleanContextDamage
      }
      const expected = score()
      expect(expected).toBeGreaterThan(0)
      await initGameData({ mode: 'beta', resonatorIds: [iuno.id] })
      expect(hasResonatorData([lynae.id, mornye.id])).toBe(false)
      expect(score()).toBeLessThan(expected)

      // rotation search keeps this same lease until the selected source changes.
      const ids = source.savedTeamContext!.team.members.map((member) => member.resonatorId)
      release = holdResonatorData(ids)
      await ensureResonatorData(ids)
      expect(hasResonatorData(ids)).toBe(true)
      expect(score()).toBeCloseTo(expected)
      const bound = rotationDamageContext(source, current, runtime)!
      expect(bound.runtime.id).toBe(iuno.id)
      expect(bound.runtime.build.team).toEqual([lynae.id, iuno.id, mornye.id])
      expect(bound.runtimesById[lynae.id].build.weapon).toEqual(live.team.members[0].loadout.weapon)
      expect(bound.combatSetup.initialOnFieldResonatorId).toBe(lynae.id)
      expect(bound.combatSetup.environmentTargetModifiers.damageTakenAmplification).toBe(0.25)
    } finally {
      release?.()
      fetch.mockRestore()
      await initGameData()
    }
  })

  it('binds saved nodes and team combat state to the current searched member', () => {
    const seed = getResSeedBy('1506')!
    const teammateSeed = getResSeedBy('1507')!
    const current = makeScenarioFromProfiles({ [seed.id]: makeResProfile(seed) }, null, 0, seed.id)
    current.program.program = [{ id: 'live-hit', type: 'feature', featureId: 'damage:1506016' }]
    const stored = structuredClone(current)
    const teammate = makeScenarioFromProfiles({ [teammateSeed.id]: makeResProfile(teammateSeed) }, null, 0, teammateSeed.id)
      .team.members[0]
    stored.team = makeScenarioTeam([...stored.team.members, teammate])
    stored.team.members[1]!.loadout.weapon.rank = 4
    stored.initialOnFieldMemberId = teammate.id
    stored.environment.targetModifiers.damageTakenAmplification = 0.25
    stored.team.members[0].loadout.weapon.rank = 5
    current.team.members[0].loadout.weapon.rank = 1
    stored.target.level = 91
    stored.program.program = [
      { id: 'saved-hit', type: 'feature', featureId: 'damage:1506016', editorSection: 'main' },
      { id: 'saved-setup', type: 'condition', changes: [], editorSection: 'preamble' },
    ]
    const saved: SavedRotation = {
      id: 'saved-one', name: 'Saved One', duration: 0, note: '',
      scenario: stored, createdAt: 1, updatedAt: 1,
    }

    expect(listRotationDamageSources(current, [saved]).map((entry) => entry.id))
      .toEqual(['default:1506', 'live', 'saved:saved-one'])
    const selected = resolveRotationDamageSource('saved:saved-one', current, [saved])!
    expect(selected).not.toHaveProperty('scenario')
    expect(selected.savedTeamContext?.team.members).toHaveLength(2)
    expect(selected.items.map((item) => item.id)).toEqual(['saved-setup', 'saved-hit'])
    const bound = rotationDamageContext(selected, current, projectScenarioRuntimes(current).subjectRuntime)!
    expect(bound.runtime.build.weapon.rank).toBe(1)
    expect(bound.runtimesById[teammateSeed.id]?.id).toBe(teammateSeed.id)
    expect(bound.runtimesById[teammateSeed.id]?.build.weapon.rank).toBe(4)
    expect(bound.combatSetup.environmentTargetModifiers.damageTakenAmplification).toBe(0.25)
    const prepared = prepareResSimulation(bound.runtime, seed, current.target, bound.runtimesById, bound.selectedTargets, bound.combatSetup)
    expect(prepared.graph.participants[prepared.graph.activeSlotId]?.resonatorId).toBe(teammateSeed.id)
    expect(prepared.context.enemy.level).toBe(current.target.level)
    const scoringInput = {
      runtime: bound.runtime, seed, enemy: current.target, items: selected.items,
      runtimesById: bound.runtimesById, selectedTargets: bound.selectedTargets,
    }
    const withSavedModifiers = captureRotationDamagePlan({ ...scoringInput, combatSetup: bound.combatSetup })
    const withoutSavedModifiers = captureRotationDamagePlan(scoringInput)
    expect(withSavedModifiers.cleanContextDamage).toBeGreaterThan(withoutSavedModifiers.cleanContextDamage)
    expect(resolveRotationDamageSource('live', current, [saved])?.items.map((item) => item.id))
      .toEqual(['live-hit'])
    expect(resolveRotationDamageSource('deleted', current, [saved])?.id).toBe('default:1506')
  })
})
