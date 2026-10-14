/*
  Author: Runor Ewhro
  description: keeps inventory rehydration read-only for unchanged data while
               preserving catalog repairs and changes made between loads.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APPSTOREINVC, APPSTOREINVR, APPSTOREINVS, consumePersist, loadPrssInvS, saveAppState } from '@/application/persistence/storage'
import { useAppStore } from '@/application/state/store'
import { useTeamCnsl } from '@/modules/simulation/features/teams/lib/teamConsoleStore'
import { mkNtlAppStt } from '@/application/state/storeHelpers'
import { selectPersisted } from '@/application/state/serialization'
import { isBuildSaved, isEchoSaved, selectSavedBuildSignatures, selectSavedEchoSignatures } from '@/application/state/savedGearStatus'
import { makeAppState } from '@/engine/runtime/defaults'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { makeSavedRotation, makeSavedBuild, makeSavedEcho } from '@/domain/entities/inventoryStorage'
import { listEchoes } from '@/data/catalog/echoCatalogService'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'

describe('inventory hydration writes', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      get length() { return values.size },
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      key: (index: number) => [...values.keys()][index] ?? null,
      clear: () => values.clear(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('does not rewrite unchanged inventory on repeated loads, and sees later storage changes', () => {
    const state = makeAppState()
    state.library.rotations = [makeSavedRotation({
      name: 'Saved rotation', scenario: selectedCombatScenario(state.combat),
    }, 100)]
    saveAppState(state, { domains: ['library.echoes', 'library.builds', 'library.rotations', 'library.scenarios'] })
    const write = vi.spyOn(localStorage, 'setItem')

    const first = loadPrssInvS()
    expect(loadPrssInvS()).toEqual(first)
    expect(write).not.toHaveBeenCalled()

    state.library.rotations[0].name = 'Updated elsewhere'
    saveAppState(state, { domains: ['library.rotations'] })
    write.mockClear()
    expect(loadPrssInvS().rotations[0].name).toBe('Updated elsewhere')
    expect(write).not.toHaveBeenCalled()
  })

  it('persists repaired Echo identities once without rewriting unrelated domains', () => {
    const state = makeAppState()
    const definition = listEchoes().find((echo) => echo.sets.length > 0)!
    const [key, value] = Object.entries(ECHO_MAIN_STATS[definition.cost])[0]
    const echo = {
      id: definition.id, uid: 'duplicate-uid', set: definition.sets[0], mainEcho: false,
      mainStats: { primary: { key, value }, secondary: { ...ECHO_SIDE_STATS[definition.cost] } },
      substats: {},
    }
    state.library.echoes = [
      { id: 'first', echo, createdAt: 1, updatedAt: 1 },
      { id: 'second', echo: structuredClone(echo), createdAt: 2, updatedAt: 2 },
    ]
    saveAppState(state, { domains: ['library.echoes', 'library.builds', 'library.rotations', 'library.scenarios'] })
    const write = vi.spyOn(localStorage, 'setItem')

    const repaired = loadPrssInvS()
    expect(new Set(repaired.echoes.map((entry) => entry.echo.uid)).size).toBe(2)
    expect(write.mock.calls.map(([key]) => key)).toEqual([APPSTOREINVC])
    write.mockClear()
    expect(loadPrssInvS()).toEqual(repaired)
    expect(write).not.toHaveBeenCalled()
  })

  it('keeps gear status available across saved-view eviction without reading saved scenarios at boot', () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    consumePersist()
    const state = makeAppState()
    const definition = listEchoes().find((echo) => echo.sets.length > 0)!
    const [key, value] = Object.entries(ECHO_MAIN_STATS[definition.cost])[0]
    const echo = {
      id: definition.id, uid: 'equipped-uid', set: definition.sets[0], mainEcho: false,
      mainStats: { primary: { key, value }, secondary: { ...ECHO_SIDE_STATS[definition.cost] } },
      substats: {},
    }
    const scenario = selectedCombatScenario(state.combat)
    const member = scenario.team.members[0]
    const build = { weapon: member.loadout.weapon, echoes: [echo, null, null, null, null] }
    state.library.echoes = [makeSavedEcho(echo)]
    state.library.builds = [makeSavedBuild({
      name: 'Equipped', resonatorId: member.resonatorId, resonatorName: member.resonatorId, build,
    })]
    state.library.rotations = [makeSavedRotation({ name: 'Saved', scenario })]
    state.library.scenarios = [{ id: 'legacy-snapshot', name: 'Scenario', note: '', scenario, createdAt: 1, updatedAt: 1 }]
    saveAppState(state)
    const read = vi.spyOn(localStorage, 'getItem')
    const boot = mkNtlAppStt()
    expect(read.mock.calls.map(([key]) => key)).not.toContain(APPSTOREINVR)
    expect(read.mock.calls.map(([key]) => key)).not.toContain(APPSTOREINVS)
    expect(boot.library.rotations).toEqual([])
    useAppStore.setState({ ...boot, invHydr: true, savedRotationsHydrated: false })
    const echoes = selectSavedEchoSignatures(useAppStore.getState())
    const builds = selectSavedBuildSignatures(useAppStore.getState())
    expect(isEchoSaved(echoes, { ...echo, uid: 'different-uid', mainEcho: true })).toBe(true)
    expect(isBuildSaved(builds, build)).toBe(true)

    read.mockClear()
    useAppStore.getState().setInvOpen(true)
    useAppStore.getState().setInvOpen(false)
    useTeamCnsl.getState().open(member.resonatorId)
    useTeamCnsl.getState().close()
    expect(useAppStore.getState().addInvEcho(echo)).toBeNull()
    expect(read).not.toHaveBeenCalled()

    const releaseFirst = useAppStore.getState().acquireSavedRotationsLease()
    const rotations = useAppStore.getState().library.rotations
    expect(rotations).toHaveLength(1)
    read.mockClear()
    releaseFirst()
    vi.advanceTimersByTime(1_000)
    const releaseReopen = useAppStore.getState().acquireSavedRotationsLease()
    expect(useAppStore.getState().library.rotations).toBe(rotations)
    expect(read).not.toHaveBeenCalled()
    vi.advanceTimersByTime(20_000)
    expect(useAppStore.getState().savedRotationsHydrated).toBe(true)
    releaseReopen()
    vi.advanceTimersByTime(15_000)
    expect(useAppStore.getState().savedRotationsHydrated).toBe(false)
    expect(useAppStore.getState().library.rotations).toEqual([])
    expect(selectSavedEchoSignatures(useAppStore.getState())).toBe(echoes)
    expect(selectSavedBuildSignatures(useAppStore.getState())).toBe(builds)
    expect(isEchoSaved(echoes, echo)).toBe(true)
    expect(isBuildSaved(builds, build)).toBe(true)

    read.mockClear()
    useTeamCnsl.getState().open(member.resonatorId)
    useTeamCnsl.getState().close()
    expect(read).not.toHaveBeenCalled()

    // gear mutations update shared status without touching the evicted snapshots.
    read.mockClear()
    useAppStore.getState().rmInvEcho(state.library.echoes[0].id)
    useAppStore.getState().rmInvBuild(state.library.builds[0].id)
    useAppStore.getState().flushPrssNow()
    expect(isEchoSaved(selectSavedEchoSignatures(useAppStore.getState()), echo)).toBe(false)
    expect(isBuildSaved(selectSavedBuildSignatures(useAppStore.getState()), build)).toBe(false)
    expect(read).not.toHaveBeenCalled()

    // an explicit full export restores saved snapshots, including writes made before eviction.
    useAppStore.getState().ensureFullLibrary()
    const snapshot = selectPersisted(useAppStore.getState())
    expect(snapshot.library.rotations).toEqual(rotations)
    expect(snapshot.library.scenarios).toEqual(state.library.scenarios)
    useAppStore.getState().updInvRot(rotations[0].id, { name: 'Renamed' })
    vi.advanceTimersByTime(15_000)
    expect(useAppStore.getState().library.rotations).toEqual([])
    expect(loadPrssInvS('saved').rotations[0].name).toBe('Renamed')
  })

  it('loads only the requested domains even when the gear bag is empty', () => {
    const state = makeAppState()
    state.library.rotations = [makeSavedRotation({
      name: 'Saved', scenario: selectedCombatScenario(state.combat),
    })]
    saveAppState(state, { domains: ['library.rotations'] })
    const read = vi.spyOn(localStorage, 'getItem')
    expect(loadPrssInvS('gear')).toEqual({ echoes: [], builds: [], rotations: [], scenarios: [] })
    expect(read.mock.calls.map(([key]) => key)).not.toContain(APPSTOREINVR)
    expect(read.mock.calls.map(([key]) => key)).not.toContain(APPSTOREINVS)
  })
})
