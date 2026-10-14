/*
  Author: Runor Ewhro
  description: verifies legacy migration and granular v28 scenario-library persistence.
*/

import { SHOWCASE_INDEX } from '@/application/persistence/showcaseCards'
import { APPSTOREUILY } from '@/application/persistence/storageKeys'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decompressFromUTF16 } from 'lz-string'
import { combatScenarioId, contextScenarioMember, makeScenarioTeam } from '@/domain/entities/combatScenario'
import { makeSavedScenario } from '@/domain/entities/inventoryStorage'
import { makeSavedRotation } from '@/domain/entities/inventoryStorage'
import { addScenario, listContextResonatorScenarios, replaceScenario, selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { makeAppState, makeResProfile, makeScenarioFromProfiles, mkDefRandGnr } from '@/engine/runtime/defaults'
import { listResSds } from '@/data/catalog/resonatorSeedService'
import { DEF_SHOWCASE_CARD_STYLE, DEF_SHOWCASE_HIDE } from '@/domain/entities/preferences'
import { projectScenarioWorkspaceProfiles } from '@/engine/runtime/scenarioRuntime'
import { projectScenarioMemberRuntime } from '@/engine/runtime/scenarioRuntime'
import { getDefaultRotation } from '@/data/catalog/gameDataService.ts'
import { migrateAdvancedScenarioRotations } from '@/engine/runtime/advancedRotationMigration.ts'
import { useAppStore } from '@/application/state/store'
import {
  APP_STORAGE_KEY,
  APPSTORECMBT,
  APPSTORECMBTINDEX,
  APPSTOREINVC,
  APPSTOREINVR,
  APPSTOREINVS,
  APPSTOREOPTS,
  APPSTOREUIPP,
  consumePersist,
  loadPrssAppS,
  loadPrssInvS,
  parsePersisted,
  saveAppState,
} from '@/application/persistence/storage'

function makeMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, value: string) => { values.set(key, value) },
  } as Storage
}

describe('persisted state compatibility', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeMemoryStorage())
  })

  afterEach(() => vi.unstubAllGlobals())

  it.each([false, true])('persists compressed exports = %s through the settings action and reload', (enabled) => {
    consumePersist()
    useAppStore.getState().setCmprXprts(enabled)
    useAppStore.getState().flushPrssNow()

    expect(JSON.parse(localStorage.getItem(APPSTOREUILY)!).ui.compressedExports).toBe(enabled)
    expect(loadPrssAppS({ includeInventory: false })?.ui.compressedExports).toBe(enabled)
  })

  it('loads saves that still carry ui keys retired with the legacy pages', () => {
    const state = makeAppState()
    state.ui.compressedExports = false
    saveAppState(state, { domains: ['ui.layout'] })
    const stored = JSON.parse(localStorage.getItem(APPSTOREUILY)!)
    stored.ui.leftPaneView = 'echoes'
    stored.ui.optimizerUseSprite = false
    localStorage.setItem(APPSTOREUILY, JSON.stringify(stored))

    const loaded = loadPrssAppS({ includeInventory: false })
    expect(loaded).not.toBeNull()
    expect(loaded?.ui.compressedExports).toBe(false)
    expect(loaded?.ui).not.toHaveProperty('leftPaneView')
    expect(loaded?.ui).not.toHaveProperty('optimizerUseSprite')
  })

  it('writes only the changed Showcase card and keeps it out of layout serialization', () => {
    const state = makeAppState()
    const card = { style: { ...DEF_SHOWCASE_CARD_STYLE }, hidden: { ...DEF_SHOWCASE_HIDE } }
    state.ui.preferences.showcaseCards = { a: card, b: { ...card } }
    saveAppState(state, { domains: ['ui.layout'] })
    const write = vi.spyOn(localStorage, 'setItem')
    const next = { ...state, ui: { ...state.ui, preferences: { ...state.ui.preferences, showcaseCards: {
      ...state.ui.preferences.showcaseCards, a: { ...card, style: { ...card.style, opacity: 42 } },
    } } } }
    saveAppState(next, { domains: ['ui.showcaseCards'] })
    expect(write.mock.calls.map(([key]) => key)).toEqual([`${SHOWCASE_INDEX}.card.a`])
    expect(JSON.parse(localStorage.getItem(APPSTOREUILY)!).ui.preferences.showcaseCards).toEqual({})
    expect(loadPrssAppS()?.ui.preferences.showcaseCards.a.style.opacity).toBe(42)
    write.mockRestore()
  })

  it('migrates legacy cards before removing their layout copy and preserves reset deletions', () => {
    const state = makeAppState()
    saveAppState(state)
    const layout = JSON.parse(localStorage.getItem(APPSTOREUILY)!)
    layout.ui.preferences.showcaseCards = { a: { style: { ...DEF_SHOWCASE_CARD_STYLE, opacity: 31 }, hidden: DEF_SHOWCASE_HIDE } }
    localStorage.setItem(APPSTOREUILY, JSON.stringify(layout))
    localStorage.removeItem(SHOWCASE_INDEX)
    const loaded = loadPrssAppS()!
    expect(loaded.ui.preferences.showcaseCards.a.style.opacity).toBe(31)
    expect(JSON.parse(localStorage.getItem(SHOWCASE_INDEX)!)).toEqual(['a'])
    loaded.ui.preferences.showcaseCards = {}
    saveAppState(loaded, { domains: ['ui.showcaseCards'] })
    expect(loadPrssAppS()?.ui.preferences.showcaseCards).toEqual({})
  })

  it('keeps the legacy card copy when migration storage fails', () => {
    const state = makeAppState()
    saveAppState(state)
    const layout = JSON.parse(localStorage.getItem(APPSTOREUILY)!)
    layout.ui.preferences.showcaseCards = { a: { style: DEF_SHOWCASE_CARD_STYLE, hidden: DEF_SHOWCASE_HIDE } }
    localStorage.setItem(APPSTOREUILY, JSON.stringify(layout))
    localStorage.removeItem(SHOWCASE_INDEX)
    const original = localStorage.setItem.bind(localStorage)
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key.startsWith(SHOWCASE_INDEX)) throw new Error('quota')
      original(key, value)
    })
    expect(loadPrssAppS()?.ui.preferences.showcaseCards.a).toBeDefined()
    expect(JSON.parse(localStorage.getItem(APPSTOREUILY)!).ui.preferences.showcaseCards.a).toBeDefined()
    write.mockRestore()
  })

  it('round-trips preset targets and discards legacy current-rotation selections', () => {
    const state = makeAppState()
    state.simulation.suggestionsByResonatorId = {
      '1208': { settings: { targetFeatureId: null, rotationMode: true }, random: mkDefRandGnr() },
      '1108': { settings: { targetFeatureId: 'damage:1108001', rotationMode: true }, random: mkDefRandGnr() },
    }
    Object.assign(state.simulation.suggestionsByResonatorId['1208'].settings, { rotationSource: 'current' })
    state.simulation.optimizerSettings = {
      ...state.simulation.optimizerSettings,
      targetMode: 'combo',
      rotationMode: true,
      targetComboSourceId: 'default:1208',
    }
    saveAppState(state)

    const loaded = loadPrssAppS()
    expect(loaded?.simulation.suggestionsByResonatorId['1208'].settings).toEqual({
      targetFeatureId: null,
      rotationMode: true,
    })
    expect(loaded?.simulation.optimizerSettings.targetComboSourceId).toBe('default:1208')
    expect(loaded?.simulation.optimizerSettings.rotationMode).toBe(true)
  })

  it('uses catalog defaults in place of old compact sequences and omits them from new records', () => {
    const state = makeAppState()
    const scenario = selectedCombatScenario(state.combat)
    const resonatorId = contextScenarioMember(scenario).resonatorId
    const manual = [{
      id: 'retired-manual-step', type: 'feature' as const,
      resonatorId, featureId: 'old-manual-feature', enabled: true, multiplier: 1,
    }]
    scenario.program.sequence = manual

    saveAppState(state, { domains: ['combat.workspace'] })
    const index = JSON.parse(localStorage.getItem(APPSTORECMBTINDEX)!)
    const manifest = JSON.parse(localStorage.getItem(index.recordsById[scenario.id])!)
    const raw = localStorage.getItem(manifest.programRecord)!
    const program = JSON.parse(raw.startsWith('wwcalc-lz1:')
      ? decompressFromUTF16(raw.slice('wwcalc-lz1:'.length))! : raw)
    expect(program).not.toHaveProperty('sequence')

    const loaded = selectedCombatScenario(loadPrssAppS()!.combat)
    const expected = getDefaultRotation(resonatorId)?.items ?? []
    expect(loaded.program.sequence).toEqual(expected)
    expect(projectScenarioMemberRuntime(loaded, contextScenarioMember(loaded)).rotation.sequence)
      .toEqual(expected)
    expect(loaded.program.program).toEqual(scenario.program.program)
  })

  it('retains old advanced sequence content until it is archived', () => {
    const state = makeAppState()
    const scenario = selectedCombatScenario(state.combat)
    const advanced = [{
      id: 'old-advanced-condition', type: 'condition' as const,
      changes: [{ type: 'set' as const, path: 'runtime.test', value: 1 }],
    }]
    scenario.program.sequence = advanced
    saveAppState(state, { domains: ['combat.workspace'] })

    const loaded = loadPrssAppS()!
    const restored = selectedCombatScenario(loaded.combat)
    expect(restored.program.sequence).toEqual(advanced)
    expect(projectScenarioMemberRuntime(restored, contextScenarioMember(restored)).rotation.sequence)
      .toEqual(getDefaultRotation(contextScenarioMember(restored).resonatorId)?.items ?? [])
    const archived = migrateAdvancedScenarioRotations(loaded.library, loaded.combat)
    expect(archived.migrations).toHaveLength(1)
    expect(archived.migrations[0].savedRotation.scenario.program.program).toEqual(advanced)
    expect(archived.combat.scenariosById[restored.id].program.program).toEqual(restored.program.program)
  })

  it('edits a reloaded getter-backed scenario through the runtime store and persists the change', () => {
    const originalState = useAppStore.getState()
    try {
      const initial = makeAppState()
      const seed = listResSds().find((entry) => entry.id === '1108')!
      const inactive = {
        ...makeScenarioFromProfiles({ [seed.id]: makeResProfile(seed) }, null, 0, seed.id),
        id: combatScenarioId(`legacy:${seed.id}`),
      }
      initial.combat = addScenario(initial.combat, inactive, false)
      saveAppState(initial)
      const loaded = loadPrssAppS()!
      const scenario = loaded.combat.scenariosById[inactive.id]
      expect(Object.getOwnPropertyDescriptor(loaded.combat.scenariosById, scenario.id)?.get).toBeTypeOf('function')
      useAppStore.setState({ combat: loaded.combat })
      useAppStore.getState().selectContextResonator(seed.id)
      expect(useAppStore.getState().combat.selectedScenarioId).toBe(inactive.id)

      useAppStore.getState().updScenarioResRt(scenario.id, scenario.team.members[0].resonatorId, (runtime) => ({
        ...runtime,
        base: { ...runtime.base, level: 42 },
      }))
      const edited = selectedCombatScenario(useAppStore.getState().combat)
      expect(edited.team.members[0].progression.level).toBe(42)
      expect(scenario.team.members[0].progression.level).not.toBe(42)
      saveAppState(useAppStore.getState(), { domains: ['combat.workspace'] })
      expect(selectedCombatScenario(loadPrssAppS()!.combat).team.members[0].progression.level).toBe(42)
    } finally {
      useAppStore.setState(originalState, true)
    }
  })

  it('migrates v22 profiles and calculator inventory into canonical scenarios and the root library', () => {
    const current = makeAppState()
    const scenario = selectedCombatScenario(current.combat)
    const profiles = projectScenarioWorkspaceProfiles(current.combat)
    const legacy = {
      version: 22,
      ui: current.ui,
      simulation: {
        runtimeRevision: 7,
        profiles,
        session: {
          activeResonatorId: scenario.team.members[0].resonatorId,
          enemyProfile: scenario.target,
        },
        inventoryEchoes: [],
        inventoryBuilds: [],
        inventoryRotations: [],
        optimizerContext: {
          resonatorId: scenario.team.members[0].resonatorId,
          settings: {
            ...current.simulation.optimizerSettings,
            resultsLimit: 321,
          },
        },
        weaponSuggests: current.simulation.weaponSuggests,
        suggestionsByResonatorId: current.simulation.suggestionsByResonatorId,
      },
    }

    const migrated = parsePersisted(JSON.stringify(legacy))
    expect(migrated.version).toBe(28)
    expect(migrated.combat.order).toHaveLength(Object.keys(profiles).length)
    expect(contextScenarioMember(selectedCombatScenario(migrated.combat)).resonatorId)
      .toBe(scenario.team.members[0].resonatorId)
    expect(migrated.library).toEqual({ echoes: [], builds: [], rotations: [], scenarios: [] })
    expect(migrated.simulation).not.toHaveProperty('profiles')
    expect(migrated.simulation).not.toHaveProperty('runtimeRevision')
    expect(migrated.simulation).not.toHaveProperty('optimizerContext')
    expect(migrated.simulation.optimizerSettingsResonatorId)
      .toBe(scenario.team.members[0].resonatorId)
    expect(migrated.simulation.optimizerSettings.resultsLimit).toBe(321)
  })

  it.each([
    ['layout domain', APPSTOREUILY],
    ['combat index', APPSTORECMBTINDEX],
  ])('retains and cleanly retries a v22 monolith when the %s write fails', (_label, failingKey) => {
    const current = makeAppState()
    const scenario = selectedCombatScenario(current.combat)
    const profiles = projectScenarioWorkspaceProfiles(current.combat)
    const legacyKey = 'wwcalc.app.v22'
    const legacy = JSON.stringify({
      version: 22,
      ui: current.ui,
      calculator: {
        runtimeRevision: 7,
        profiles,
        session: {
          activeResonatorId: contextScenarioMember(scenario).resonatorId,
          enemyProfile: scenario.target,
        },
        inventoryEchoes: [],
        inventoryBuilds: [],
        inventoryRotations: [],
        optimizerContext: {
          resonatorId: contextScenarioMember(scenario).resonatorId,
          settings: current.simulation.optimizerSettings,
        },
        weaponSuggests: current.simulation.weaponSuggests,
        suggestionsByResonatorId: current.simulation.suggestionsByResonatorId,
      },
    })
    localStorage.setItem(legacyKey, legacy)
    const originalSetItem = localStorage.setItem.bind(localStorage)
    let failWrite = true
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (failWrite && key === failingKey) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }
      originalSetItem(key, value)
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const firstLoad = loadPrssAppS()
    expect(firstLoad).not.toBeNull()
    expect(Object.keys(projectScenarioWorkspaceProfiles(firstLoad!.combat)).sort())
      .toEqual(Object.keys(profiles).sort())
    expect(localStorage.getItem(legacyKey)).toBe(legacy)
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key) => key === APP_STORAGE_KEY || key?.startsWith(`${APP_STORAGE_KEY}.`)))
      .toEqual([])

    failWrite = false
    const retried = loadPrssAppS()
    expect(retried).not.toBeNull()
    expect(Object.keys(projectScenarioWorkspaceProfiles(retried!.combat)).sort())
      .toEqual(Object.keys(profiles).sort())
    expect(localStorage.getItem(legacyKey)).toBeNull()
    expect(localStorage.getItem(APPSTORECMBTINDEX)).toContain('recordsById')
  })

  it('retains and retries a current-version monolith when granular migration fails', () => {
    const state = makeAppState()
    const monolith = JSON.stringify(state)
    localStorage.setItem(APP_STORAGE_KEY, monolith)
    const originalSetItem = localStorage.setItem.bind(localStorage)
    let failWrite = true
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (failWrite && key === APPSTORECMBTINDEX) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }
      originalSetItem(key, value)
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(loadPrssAppS()?.combat).toEqual(state.combat)
    expect(localStorage.getItem(APP_STORAGE_KEY)).toBe(monolith)
    expect(localStorage.getItem(APPSTORECMBTINDEX)).toBeNull()

    failWrite = false
    expect(loadPrssAppS()?.combat).toEqual(state.combat)
    expect(localStorage.getItem(APP_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(APPSTORECMBTINDEX)).toContain('recordsById')
  })

  it('migrates split v26 optimizer settings without retaining the runtime copy', () => {
    const state = makeAppState()
    const scenario = selectedCombatScenario(state.combat)
    const savedScenario = makeSavedScenario({
      name: 'v26 scenario',
      scenario,
    }, 789)
    localStorage.setItem('wwcalc.app.v26.combat.workspace', JSON.stringify({
      version: 26,
      combat: state.combat,
    }))
    localStorage.setItem('wwcalc.app.v26.inventory.scenarios', JSON.stringify({
      version: 26,
      library: { scenarios: [savedScenario] },
    }))
    localStorage.setItem('wwcalc.app.v26.optimizer-context', JSON.stringify({
      version: 26,
      simulation: {
        optimizerContext: {
          resonatorId: contextScenarioMember(scenario).resonatorId,
          settings: {
            ...state.simulation.optimizerSettings,
            keepPercent: 0.75,
          },
        },
      },
    }))

    const migrated = loadPrssAppS()
    expect(migrated?.version).toBe(28)
    expect(migrated?.combat).toEqual(state.combat)
    expect(migrated?.library.scenarios).toEqual([savedScenario])
    expect(migrated?.simulation.optimizerSettings.keepPercent).toBe(0.75)
    expect(migrated?.simulation.optimizerSettingsResonatorId)
      .toBe(contextScenarioMember(scenario).resonatorId)
    expect(migrated?.simulation).not.toHaveProperty('optimizerContext')
  })

  it('renames calculator-root and benchmark-era preferences at the v28 boundary', () => {
    const current = makeAppState()
    const legacyPreferenceKeys = new Set([
      'animatedRailPortraits',
      'showcaseCards',
    ])
    const remainingPreferences = Object.fromEntries(
      Object.entries(current.ui.preferences).filter(([key]) => !legacyPreferenceKeys.has(key)),
    )
    const legacy = {
      ...current,
      version: 27,
      simulation: undefined,
      calculator: current.simulation,
      ui: {
        ...current.ui,
        preferences: {
          ...remainingPreferences,
          showBenchStates: true,
          benchAnim2d: false,
          benchmarkCards: {
            test: {
              style: {
                ...DEF_SHOWCASE_CARD_STYLE,
                customCss: '.bench-card { color: var(--bench-accent); }',
              },
              hidden: DEF_SHOWCASE_HIDE,
            },
          },
        },
      },
    }

    const migrated = parsePersisted(JSON.stringify(legacy))
    expect(migrated.version).toBe(28)
    expect(migrated.simulation).toEqual(current.simulation)
    expect(migrated).not.toHaveProperty('calculator')
    expect(migrated.ui.preferences.animatedRailPortraits).toBe(false)
    expect(migrated.ui.preferences.showcaseCards.test.style.customCss)
      .toBe('.workspace-card { color: var(--workspace-accent); }')
    expect(migrated.ui.preferences).not.toHaveProperty('showBenchStates')
    expect(migrated.ui.preferences).not.toHaveProperty('benchmarkCards')
  })

  it('collapses experimental v25 duplicate contexts and keeps the selected document', () => {
    const current = makeAppState()
    const original = selectedCombatScenario(current.combat)
    const duplicateId = combatScenarioId('scenario:selected-duplicate')
    const duplicate = {
      ...structuredClone(original),
      id: duplicateId,
      target: { ...original.target, level: original.target.level + 9 },
    }
    const legacy = {
      ...current,
      version: 25,
      library: undefined,
      combat: {
        selectedScenarioId: duplicateId,
        order: [original.id, duplicateId],
        documentsById: {
          [original.id]: { id: original.id, name: 'Original', createdAt: 1, updatedAt: 1, scenario: original },
          [duplicateId]: { id: duplicateId, name: 'Selected', createdAt: 2, updatedAt: 2, scenario: duplicate },
        },
      },
    }

    const migrated = parsePersisted(JSON.stringify(legacy))
    expect(migrated.combat.order).toEqual([duplicateId])
    expect(migrated.combat.selectedScenarioId).toBe(duplicateId)
    expect(selectedCombatScenario(migrated.combat).target.level).toBe(duplicate.target.level)
  })

  it('round-trips working scenarios and all root artifact categories through granular storage', () => {
    const state = makeAppState()
    const scenario = selectedCombatScenario(state.combat)
    const rotation = makeSavedRotation({ name: 'Stored rotation', scenario }, 122)
    state.library.rotations.push(rotation)
    state.library.scenarios.push(makeSavedScenario({
      name: 'Stored scenario',
      note: 'snapshot',
      scenario,
    }, 123))

    saveAppState(state)
    expect(localStorage.getItem(APPSTORECMBTINDEX)).toContain('recordsById')
    expect(localStorage.getItem(APPSTOREINVS)).toContain('Stored scenario')
    expect(localStorage.getItem(APPSTOREINVC)).toContain('"echoes"')
    const storedRotations = localStorage.getItem(APPSTOREINVR)
    expect(storedRotations?.startsWith('wwcalc-lz1:')).toBe(true)
    expect(storedRotations?.length).toBeLessThan(JSON.stringify({
      version: state.version,
      library: { rotations: [rotation] },
    }).length)
    expect(localStorage.getItem(APPSTOREOPTS)).toContain('optimizerSettings')
    expect(localStorage.getItem(APPSTOREOPTS)).toContain('optimizerSettingsResonatorId')
    expect(localStorage.getItem(APPSTOREUIPP)).toContain('theme')

    const loaded = loadPrssAppS()
    expect(loaded).not.toBeNull()
    expect(loaded?.combat.selectedScenarioId).toEqual(state.combat.selectedScenarioId)
    expect(loaded?.combat.order).toEqual(state.combat.order)
    expect(loaded?.combat.scenariosById).toEqual(state.combat.scenariosById)
    expect(loaded?.library.rotations).toEqual([rotation])
    expect(loaded?.library.scenarios).toEqual(state.library.scenarios)
  })

  it('rewrites only the edited scenario record and reloads the complete workspace', () => {
    const state = makeAppState()
    const first = selectedCombatScenario(state.combat)
    const otherSeed = listResSds().find((seed) => seed.id !== first.team.members[0].resonatorId)!
    const other = {
      ...makeScenarioFromProfiles({ [otherSeed.id]: makeResProfile(otherSeed) }, null, 0, otherSeed.id),
      id: combatScenarioId('storage:other'),
    }
    state.combat = addScenario(state.combat, other, false)
    saveAppState(state, { domains: ['combat.workspace'] })
    const before = JSON.parse(localStorage.getItem(APPSTORECMBTINDEX)!) as {
      recordsById: Record<string, string>
    }
    const beforeManifestRaw = localStorage.getItem(before.recordsById[first.id])!

    const updated = {
      ...first,
      revision: first.revision + 1,
      target: { ...first.target, level: first.target.level + 1 },
    }
    state.combat = {
      ...state.combat,
      scenariosById: { ...state.combat.scenariosById, [first.id]: updated },
    }
    saveAppState(state, { domains: ['combat.workspace'] })
    const after = JSON.parse(localStorage.getItem(APPSTORECMBTINDEX)!) as {
      recordsById: Record<string, string>
    }

    expect(after.recordsById[first.id]).not.toBe(before.recordsById[first.id])
    expect(after.recordsById[other.id]).toBe(before.recordsById[other.id])
    const decodeManifest = (raw: string) => {
      return JSON.parse(raw.startsWith('wwcalc-lz1:') ? decompressFromUTF16(raw.slice('wwcalc-lz1:'.length))! : raw) as {
        format: number; targetRecord: string; environmentRecord: string; programRecord: string; memberRecords: Record<string, string>
      }
    }
    const oldManifest = decodeManifest(beforeManifestRaw)
    const newManifest = decodeManifest(localStorage.getItem(after.recordsById[first.id])!)
    expect(newManifest.format).toBe(2)
    expect(newManifest.targetRecord).not.toBe(oldManifest.targetRecord)
    expect(newManifest.environmentRecord).toBe(oldManifest.environmentRecord)
    expect(newManifest.programRecord).toBe(oldManifest.programRecord)
    expect(newManifest.memberRecords).toEqual(oldManifest.memberRecords)
    // known obsolete keys are reclaimed directly after the manifest commit.
    expect(localStorage.getItem(before.recordsById[first.id])).toBeNull()
    const reloaded = loadPrssAppS()?.combat
    expect(Object.getOwnPropertyDescriptor(reloaded?.scenariosById, other.id)?.get).toBeTypeOf('function')
    expect(reloaded?.selectedScenarioId).toEqual(state.combat.selectedScenarioId)
    expect(reloaded?.order).toEqual(state.combat.order)
    expect(reloaded?.scenariosById).toEqual(state.combat.scenariosById)
  })

  it('keeps an inactive scenario on disk during a selected-scenario edit', () => {
    const initial = makeAppState()
    const selected = selectedCombatScenario(initial.combat)
    const seed = listResSds().find((entry) => entry.id !== contextScenarioMember(selected).resonatorId)!
    const inactive = {
      ...makeScenarioFromProfiles({ [seed.id]: makeResProfile(seed) }, null, 0, seed.id),
      id: combatScenarioId('storage:lazy'),
    }
    initial.combat = addScenario(initial.combat, inactive, false)
    saveAppState(initial, { domains: ['combat.workspace'] })
    const before = JSON.parse(localStorage.getItem(APPSTORECMBTINDEX)!) as {
      recordsById: Record<string, string>
    }
    const loaded = loadPrssAppS()!
    expect(listContextResonatorScenarios(loaded.combat).map((entry) => entry.scenarioId))
      .toContain(inactive.id)
    expect(Object.getOwnPropertyDescriptor(loaded.combat.scenariosById, inactive.id)?.get)
      .toBeTypeOf('function')
    loaded.combat = replaceScenario(loaded.combat, {
      ...selectedCombatScenario(loaded.combat),
      revision: selected.revision + 1,
    })
    saveAppState(loaded, { domains: ['combat.workspace'] })
    const after = JSON.parse(localStorage.getItem(APPSTORECMBTINDEX)!) as {
      recordsById: Record<string, string>
    }
    expect(after.recordsById[inactive.id]).toBe(before.recordsById[inactive.id])
    expect(Object.getOwnPropertyDescriptor(loaded.combat.scenariosById, inactive.id)?.get)
      .toBeTypeOf('function')
  })

  it('writes only an edited member and rejects invalid cross-member references', () => {
    const state = makeAppState()
    const original = selectedCombatScenario(state.combat)
    saveAppState(state, { domains: ['combat.workspace'] })
    const firstIndex = JSON.parse(localStorage.getItem(APPSTORECMBTINDEX)!) as { recordsById: Record<string, string> }
    const readManifest = (key: string) => {
      const raw = localStorage.getItem(key)!
      return JSON.parse(raw.startsWith('wwcalc-lz1:')
        ? decompressFromUTF16(raw.slice('wwcalc-lz1:'.length))! : raw) as {
        memberRecords: Record<string, string>; targetRecord: string; environmentRecord: string; programRecord: string
      }
    }
    const before = readManifest(firstIndex.recordsById[original.id])
    const member = original.team.members[0]
    const changed = {
      ...original,
      revision: original.revision + 1,
      team: makeScenarioTeam([{ ...member, progression: { ...member.progression, level: member.progression.level + 1 } },
        ...original.team.members.slice(1)]),
    }
    state.combat = replaceScenario(state.combat, changed)
    saveAppState(state, { domains: ['combat.workspace'] })
    const secondIndex = JSON.parse(localStorage.getItem(APPSTORECMBTINDEX)!) as { recordsById: Record<string, string> }
    const after = readManifest(secondIndex.recordsById[original.id])
    expect(after.memberRecords[member.id]).not.toBe(before.memberRecords[member.id])
    expect(after.targetRecord).toBe(before.targetRecord)
    expect(after.environmentRecord).toBe(before.environmentRecord)
    expect(after.programRecord).toBe(before.programRecord)
    const invalid = { ...changed, revision: changed.revision + 1, contextMemberId: 'missing' as typeof changed.contextMemberId }
    state.combat = replaceScenario(state.combat, invalid)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    saveAppState(state, { domains: ['combat.workspace'] })
    expect(localStorage.getItem(APPSTORECMBTINDEX)).toBe(JSON.stringify(secondIndex))
    expect(loadPrssAppS()?.combat.scenariosById[original.id].team.members[0].progression.level)
      .toBe(member.progression.level + 1)
  })

  it('migrates the prior whole-workspace key without losing its scenarios', () => {
    const state = makeAppState()
    localStorage.setItem(APPSTORECMBT, JSON.stringify({ version: state.version, combat: state.combat }))

    expect(loadPrssAppS()?.combat).toEqual(state.combat)
    expect(localStorage.getItem(APPSTORECMBTINDEX)).toContain('recordsById')
    expect(localStorage.getItem(APPSTORECMBT)).toBeNull()
  })

  it('keeps the prior workspace and removes uncommitted records if migration runs out of quota', () => {
    const state = makeAppState()
    const legacy = JSON.stringify({ version: state.version, combat: state.combat })
    localStorage.setItem(APPSTORECMBT, legacy)
    const originalSetItem = localStorage.setItem.bind(localStorage)
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === APPSTORECMBTINDEX) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      originalSetItem(key, value)
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    saveAppState(state, { domains: ['combat.workspace'] })

    expect(localStorage.getItem(APPSTORECMBT)).toBe(legacy)
    expect(localStorage.getItem(APPSTORECMBTINDEX)).toBeNull()
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key) => key?.startsWith(`${APPSTORECMBT}.scenario.`))).toEqual([])
  })

  it('keeps Echo attacks in the live program across storage hydration', () => {
    const state = makeAppState()
    const scenario = selectedCombatScenario(state.combat)
    const echoAttack = {
      id: 'rotation:feature:echo-attack',
      type: 'feature' as const,
      featureId: 'echo:6000221:feature:echo:6000221:skill:1',
      resonatorId: scenario.team.members[0].resonatorId,
      enabled: true,
      multiplier: 1,
    }
    scenario.program = {
      ...scenario.program,
      program: [...scenario.program.program, echoAttack],
      lastRanAt: 456,
    }

    saveAppState(state, { domains: ['combat.workspace'] })
    const loaded = loadPrssAppS()
    const loadedScenario = loaded && selectedCombatScenario(loaded.combat)

    expect(loadedScenario?.program.program).toContainEqual(echoAttack)
    expect(loadedScenario?.program.lastRanAt).toBe(456)
  })

  it('backfills the optimizer owner in earlier granular v28 settings', () => {
    const state = makeAppState()
    const resonatorId = contextScenarioMember(selectedCombatScenario(state.combat)).resonatorId
    saveAppState(state)
    localStorage.setItem(APPSTOREOPTS, JSON.stringify({
      version: 28,
      simulation: {
        optimizerSettings: {
          ...state.simulation.optimizerSettings,
          resultsLimit: 77,
        },
      },
    }))

    const loaded = loadPrssAppS()
    expect(loaded?.simulation.optimizerSettingsResonatorId).toBe(resonatorId)
    expect(loaded?.simulation.optimizerSettings.resultsLimit).toBe(77)
  })

  it('continues to read plain-json rotation domains written before compression', () => {
    const state = makeAppState()
    const rotation = makeSavedRotation({
      name: 'Plain JSON rotation',
      scenario: selectedCombatScenario(state.combat),
    }, 124)
    localStorage.setItem(APPSTOREINVR, JSON.stringify({
      version: state.version,
      library: { rotations: [rotation] },
    }))

    expect(loadPrssInvS().rotations).toEqual([rotation])
    expect(localStorage.getItem(APPSTOREINVR)?.startsWith('wwcalc-lz1:')).toBe(true)
  })

  it('continues saving later domains when one storage write exceeds quota', () => {
    const state = makeAppState()
    state.library.scenarios.push(makeSavedScenario({
      name: 'Still persisted',
      scenario: selectedCombatScenario(state.combat),
    }, 125))
    const originalSetItem = localStorage.setItem.bind(localStorage)
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === APPSTOREINVR) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      originalSetItem(key, value)
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    saveAppState(state, { domains: ['library.rotations', 'library.scenarios'] })

    expect(localStorage.getItem(APPSTOREINVS)).toContain('Still persisted')
    expect(console.warn).toHaveBeenCalledWith(
      '[storage] failed to persist inventory rotations',
      expect.objectContaining({ name: 'QuotaExceededError' }),
    )
  })

  it('moves split v25 calculator artifacts into the v27 root library', () => {
    const state = makeAppState()
    const scenario = selectedCombatScenario(state.combat)
    const rotation = makeSavedRotation({ name: 'Legacy split rotation', scenario }, 456)
    localStorage.setItem('wwcalc.app.v25.combat.workspace', JSON.stringify({
      version: 25,
      combat: state.combat,
    }))
    localStorage.setItem('wwcalc.app.v25.inventory.rotations', JSON.stringify({
      version: 25,
      simulation: { inventoryRotations: [rotation] },
    }))

    const migrated = loadPrssAppS()
    expect(migrated?.library.rotations).toEqual([rotation])
    expect(migrated?.simulation).not.toHaveProperty('inventoryRotations')
    expect(localStorage.getItem('wwcalc.app.v25.inventory.rotations')).toBeNull()
  })

  it('retains and retries every split v25 source when a replacement domain fails', () => {
    const state = makeAppState()
    const scenario = selectedCombatScenario(state.combat)
    const rotation = makeSavedRotation({ name: 'Retry split rotation', scenario }, 457)
    const combatKey = 'wwcalc.app.v25.combat.workspace'
    const rotationsKey = 'wwcalc.app.v25.inventory.rotations'
    const combatRaw = JSON.stringify({ version: 25, combat: state.combat })
    const rotationsRaw = JSON.stringify({
      version: 25,
      simulation: { inventoryRotations: [rotation] },
    })
    localStorage.setItem(combatKey, combatRaw)
    localStorage.setItem(rotationsKey, rotationsRaw)
    const originalSetItem = localStorage.setItem.bind(localStorage)
    let failWrite = true
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (failWrite && key === APPSTOREINVR) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }
      originalSetItem(key, value)
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(loadPrssAppS()?.library.rotations).toEqual([rotation])
    expect(localStorage.getItem(combatKey)).toBe(combatRaw)
    expect(localStorage.getItem(rotationsKey)).toBe(rotationsRaw)
    expect(localStorage.getItem(APPSTORECMBTINDEX)).toBeNull()
    expect(localStorage.getItem(APPSTOREINVR)).toBeNull()

    failWrite = false
    expect(loadPrssAppS()?.library.rotations).toEqual([rotation])
    expect(localStorage.getItem(combatKey)).toBeNull()
    expect(localStorage.getItem(rotationsKey)).toBeNull()
    expect(localStorage.getItem(APPSTORECMBTINDEX)).toContain('recordsById')
    expect(localStorage.getItem(APPSTOREINVR)?.startsWith('wwcalc-lz1:')).toBe(true)
  })

  it('can defer every artifact category without changing working scenarios', () => {
    const state = makeAppState()
    state.library.scenarios.push(makeSavedScenario({
      name: 'Deferred scenario',
      scenario: selectedCombatScenario(state.combat),
    }))
    saveAppState(state)

    const loaded = loadPrssAppS({ includeInventory: false })
    expect(loaded?.combat.selectedScenarioId).toEqual(state.combat.selectedScenarioId)
    expect(loaded?.combat.order).toEqual(state.combat.order)
    expect(loaded?.combat.scenariosById).toEqual(state.combat.scenariosById)
    expect(loaded?.library).toEqual({ echoes: [], builds: [], rotations: [], scenarios: [] })
  })
})
