/*
  Author: Runor Ewhro
  description: verifies first-time teammate gear selection, cold-inventory fast
               paths, and isolation of existing teammate and effect state.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/application/state/store'
import { makeInitialTeammate } from '@/application/state/teammateInitialization'
import { consumePersist } from '@/application/persistence/storage'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { listEchoes } from '@/data/catalog/echoCatalogService'
import { combatScenarioId, contextScenarioMember, makeScenarioTeam, type ScenarioTeamMember } from '@/domain/entities/combatScenario'
import { makeSavedBuild, type SavedBuild } from '@/domain/entities/inventoryStorage'
import { addScenario, selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { makeResProfile, makeScenarioFromProfiles, makeScenarioMemberFromProfile } from '@/engine/runtime/defaults'
import { insertScenarioTeamMember, removeScenarioTeamMember } from '@/engine/runtime/scenarioMembers'
import { withSupports } from '@/modules/simulation/features/teams/lib/teamSlots'

const RESONATOR_ID = '1211'
const hydrateInventory = useAppStore.getState().ensInvHydr

function defaultMember(maxed = true) {
  return makeScenarioMemberFromProfile(makeResProfile(getResSeedBy(RESONATOR_ID)!, { maxed }))
}

function gear(slots: number, rank: number): ScenarioTeamMember['loadout'] {
  const echoes = listEchoes().filter((echo) => echo.sets.length > 0).slice(0, 5)
  return {
    weapon: { ...defaultMember().loadout.weapon, rank },
    echoes: Array.from({ length: 5 }, (_, index) => index < slots ? {
      id: echoes[index].id,
      uid: `gear:${rank}:${index}`,
      set: echoes[index].sets[0],
      mainEcho: index === 0,
      mainStats: {
        primary: { key: 'atkPercent', value: 18 },
        secondary: { key: 'hp', value: 2280 },
      },
      substats: { critRate: 6.3 },
    } : null),
  }
}

function savedBuild(slots: number, rank: number, updatedAt: number, resonatorId = RESONATOR_ID) {
  return makeSavedBuild({ name: 'Test build', resonatorId, resonatorName: 'Test', build: gear(slots, rank) }, updatedAt)
}

function installContext(slots: number, secondSeat = false) {
  const profile = makeResProfile(getResSeedBy(RESONATOR_ID)!, { maxed: true })
  profile.runtime.build = gear(slots, 2)
  profile.runtime.progression.sequence = 4
  profile.runtime.progression.level = 40
  profile.runtime.local.controls['resonator:1211:mode:value'] = 'tune_strain'
  profile.runtime.local.setConditionals.off = { '1': ['5pc'] }
  profile.runtime.local.manualBuffs.quick.atk.percent = 90
  const scenario = makeScenarioFromProfiles({ [RESONATOR_ID]: profile }, null, 0)
  scenario.id = combatScenarioId('context:denia')
  if (secondSeat) {
    const other = makeScenarioMemberFromProfile(makeResProfile(getResSeedBy('1102')!))
    scenario.team = makeScenarioTeam([other, scenario.team.members[0]])
  }
  useAppStore.setState((state) => ({ combat: addScenario(state.combat, scenario, false) }))
  return contextScenarioMember(scenario)
}

function hydrateWith(builds: SavedBuild[]) {
  return vi.spyOn(useAppStore.getState(), 'ensInvHydr').mockImplementation(() => {
    useAppStore.setState((state) => ({ library: { ...state.library, builds }, invHydr: true }))
  })
}

describe('first-time teammate initialization', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumePersist()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    // zustand copies action properties into each next state object.
    useAppStore.setState({ ensInvHydr: hydrateInventory })
  })

  it('copies full context gear and sequence without reading or hydrating inventory or copying effects', () => {
    const destination = selectedCombatScenario(useAppStore.getState().combat)
    const source = installContext(5, true)
    const hydrate = vi.spyOn(useAppStore.getState(), 'ensInvHydr')
    const builds = vi.fn(() => { throw new Error('Full context must not read inventory') })
    const library = { ...useAppStore.getState().library }
    Object.defineProperty(library, 'builds', { get: builds })
    useAppStore.setState({ library })

    const member = makeInitialTeammate(RESONATOR_ID, destination)!
    expect(hydrate).not.toHaveBeenCalled()
    expect(builds).not.toHaveBeenCalled()
    expect(member.loadout).toEqual(source.loadout)
    expect(member.progression).toEqual({ ...defaultMember().progression, sequence: 4 })
    expect(member.local).toEqual(defaultMember().local)
    expect(member.loadout.weapon).not.toBe(source.loadout.weapon)
    expect(member.loadout.echoes[0]).not.toBe(source.loadout.echoes[0])
    expect(member.local.controls['resonator:1211:mode:value']).toBe('fusion_burst')
  })

  it.each([
    { contextSlots: 3, inventorySlots: 5, expectedRank: 3 },
    { contextSlots: 3, inventorySlots: 4, expectedRank: 3 },
    { contextSlots: 4, inventorySlots: 3, expectedRank: 2 },
    { contextSlots: 4, inventorySlots: 4, expectedRank: 2 },
    { contextSlots: 0, inventorySlots: 0, expectedRank: 2 },
  ])('ranks context $contextSlots versus inventory $inventorySlots by filled slots, with context winning ties', ({ contextSlots, inventorySlots, expectedRank }) => {
    const destination = selectedCombatScenario(useAppStore.getState().combat)
    installContext(contextSlots)
    const hydrate = hydrateWith([savedBuild(inventorySlots, 3, 100)])
    const member = makeInitialTeammate(RESONATOR_ID, destination)!
    expect(hydrate).toHaveBeenCalledOnce()
    expect(member.loadout.weapon.rank).toBe(expectedRank)
    expect(member.loadout.echoes.filter(Boolean)).toHaveLength(Math.max(contextSlots, inventorySlots))
    expect(member.progression.sequence).toBe(4)
    expect(member.local).toEqual(defaultMember().local)
  })

  it('uses the most recently updated inventory build among the fullest matching builds', () => {
    const destination = selectedCombatScenario(useAppStore.getState().combat)
    const winner = savedBuild(4, 4, 50)
    const builds = [savedBuild(5, 5, 200, '1102'), savedBuild(3, 1, 100), winner, savedBuild(4, 3, 20)]
    hydrateWith(builds)
    const member = makeInitialTeammate(RESONATOR_ID, destination)!
    expect(member.loadout).toEqual(winner.build)
    expect(member.progression).toEqual(defaultMember().progression)
    expect(member.local).toEqual(defaultMember().local)
    expect(member.loadout.echoes).not.toBe(winner.build.echoes)
    expect(builds[0].resonatorId).toBe('1102')
  })

  it.each([true, false])('keeps current defaults when no source exists (Max on init: %s)', (maxed) => {
    const destination = selectedCombatScenario(useAppStore.getState().combat)
    useAppStore.getState().setMaxResInit(maxed)
    hydrateWith([])
    expect(makeInitialTeammate(RESONATOR_ID, destination)).toEqual(defaultMember(maxed))
  })

  it('reuses active and retained setups before doing any context or inventory lookup', () => {
    const base = selectedCombatScenario(useAppStore.getState().combat)
    const configured = defaultMember()
    configured.loadout = gear(1, 1)
    configured.progression.sequence = 2
    configured.local.controls['resonator:1211:mode:value'] = 'tune_strain'
    const active = insertScenarioTeamMember(base, 1, configured)
    const removed = removeScenarioTeamMember(active, configured.id)
    const source = installContext(5)
    source.progression.sequence = 6
    const hydrate = hydrateWith([savedBuild(5, 5, 100)])
    const contextRead = vi.fn(() => { throw new Error('Existing teammate must not read another scenario') })
    Object.defineProperty(useAppStore.getState().combat.scenariosById, 'context:denia', { get: contextRead, configurable: true })

    expect(makeInitialTeammate(RESONATOR_ID, active)).toBe(active.team.members[1])
    const initial = makeInitialTeammate(RESONATOR_ID, removed)!
    const rejoined = withSupports(removed, [RESONATOR_ID], () => initial)
    expect(rejoined.team.members[1]).toEqual(configured)
    expect(contextRead).not.toHaveBeenCalled()
    expect(hydrate).not.toHaveBeenCalled()
  })
})
