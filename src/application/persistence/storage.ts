/*
  Author: Runor Ewhro
  description: handles persisted app-state loading, validation, granular
               domain writes, and recovery cleanup.
*/

import { DEF_UI_PREFS } from '@/domain/entities/preferences'
import { COMPRESSED_ROTATIONS_PREFIX, encodePersistedDomain, decodePersistedDomain } from './storageCodec'
import { readCombatWorkspace, writeCombatWorkspace, scenarioRecords } from './scenarioRecords'
import { persistenceCoordinator } from './persistenceCoordinator'
import { readMonolithicState, readLegacyState } from './legacyMigration'
export { PersistenceCoordinator } from './persistenceCoordinator'
export { ScenarioRecordRepository } from './scenarioRecords'
import { SHOWCASE_INDEX, readShowcaseCards, writeShowcaseCards, clearShowcaseCards } from './showcaseCards'
import type { HydratedAppState, PersistedState } from '@/domain/entities/appState'
import type { PersistedUnknown } from '@/engine/runtime/defaults'
import { copyScenarioRecords, summarizeScenario, type ScenarioWorkspace } from '@/domain/entities/scenarioLibrary'
import { makeAppState, initAppState } from '@/engine/runtime/defaults'
import {
  APP_STATE_VER,
  persistedSchema,
  prssInvBldsS,
  prssInvChsSl,
  prssInvRttnS,
  prssInvScenariosSl,
  prssOptSettingsSl,
  prssCmbtWrkspSlcS,
  prssSuggsSlc,
  prssUiPprnSl,
  prssUiLytSlc,
  prssUiSvdRoh,
} from '@/engine/runtime/schema'

import {
  APP_STORAGE_KEY,
  APPSTOREUIPP,
  APPSTOREUILY,
  APPSTOREUISV,
  APPSTORECMBT,
  APPSTORECMBTINDEX,
  APPSTOREPRFL,
  APPSTOREOPTS,
  SUGG_STORE_KEY,
  APPSTOREINVC,
  APPSTOREINVB,
  APPSTOREINVR,
  APPSTOREINVS,
  APPSTORERCVR,
  RETIRED_SESSION_STORE_KEY,
} from './storageKeys'
export {
  APP_STORAGE_KEY,
  APPSTOREUIPP,
  APPSTOREUILY,
  APPSTOREUISV,
  APPSTORECMBT,
  APPSTORECMBTINDEX,
  APPSTOREPRFL,
  APPSTOREOPTS,
  SUGG_STORE_KEY,
  APPSTOREINVC,
  APPSTOREINVB,
  APPSTOREINVR,
  APPSTOREINVS,
  APPSTORERCVR,
} from './storageKeys'


export type PersistKey =
  | 'ui.appearance'
  | 'ui.layout'
  | 'ui.showcaseCards'
  | 'ui.savedRotationPreferences'
  | 'combat.workspace'
  | 'simulation.optimizerSettings'
  | 'simulation.suggestions'
  | 'library.echoes'
  | 'library.builds'
  | 'library.rotations'
  | 'library.scenarios'

const NONINVDMNKEY: PersistKey[] = [
  'ui.appearance',
  'ui.layout',
  'ui.showcaseCards',
  'ui.savedRotationPreferences',
  'combat.workspace',
  'simulation.optimizerSettings',
  'simulation.suggestions',
]

const GEAR_DOMAIN_KEYS: PersistKey[] = ['library.echoes', 'library.builds']
const SAVED_ROTATION_DOMAIN_KEYS: PersistKey[] = ['library.rotations', 'library.scenarios']
const INV_DOMAIN_KEYS: PersistKey[] = [...GEAR_DOMAIN_KEYS, ...SAVED_ROTATION_DOMAIN_KEYS]

export const ALL_DOMAIN_KEYS: PersistKey[] = [
  ...NONINVDMNKEY,
  ...INV_DOMAIN_KEYS,
]

type PersistDraft = PersistedUnknown
type PrssDmnSchm = {
  safeParse: (value: unknown) =>
    | { success: true; data: unknown }
    | { success: false; error?: unknown }
}

interface PersistSpec<TSlice> {
  label: string
  storageKey: string
  schema: PrssDmnSchm
  build: (state: PersistedState) => TSlice
  apply: (state: PersistDraft, slice: TSlice) => void
}



function makeAppearance(state: PersistedState) {
  return {
    version: state.version,
    ui: {
      theme: state.ui.theme,
      themePreference: state.ui.themePreference,
      lightVariant: state.ui.lightVariant,
      darkVariant: state.ui.darkVariant,
      backgroundVariant: state.ui.backgroundVariant,
      backgroundImageKey: state.ui.backgroundImageKey,
      backgroundTextMode: state.ui.backgroundTextMode,
      bodyFontName: state.ui.bodyFontName,
      bodyFontUrl: state.ui.bodyFontUrl,
      blurMode: state.ui.blurMode,
      entranceAnimations: state.ui.entranceAnimations,
    },
  }
}

function makeLayout(state: PersistedState) {
  return {
    version: state.version,
    ui: {
      preferences: { ...state.ui.preferences, showcaseCards: {} },
      suggsViewMode: state.ui.suggsViewMode,
      showSubHits: state.ui.showSubHits,
      compactInv: state.ui.compactInv,
      groupInv: state.ui.groupInv,
      seeEquipped: state.ui.seeEquipped,
      haveHistory: state.ui.haveHistory,
      historyMax: state.ui.historyMax,
      itemFreq: state.ui.itemFreq,
      optimizerCpuHintSeen: state.ui.optimizerCpuHintSeen,
      compressedExports: state.ui.compressedExports,
      rotationEditorPreferences: state.ui.rotationEditorPreferences,
    },
  }
}

function makeRotPrefs(state: PersistedState) {
  return {
    version: state.version,
    ui: {
      savedRotationPreferences: state.ui.savedRotationPreferences,
    },
  }
}

function makeCombatWorkspace(state: PersistedState) {
  return {
    version: state.version,
    combat: state.combat,
  }
}

function makeOptSettingsSlice(state: PersistedState) {
  return {
    version: state.version,
    simulation: {
      optimizerSettingsResonatorId: state.simulation.optimizerSettingsResonatorId,
      optimizerSettings: state.simulation.optimizerSettings,
    },
  }
}

function makeSuggestSlice(state: PersistedState) {
  return {
    version: state.version,
    simulation: {
      weaponSuggests: state.simulation.weaponSuggests,
      suggestionsByResonatorId: state.simulation.suggestionsByResonatorId,
    },
  }
}

function makeInvEchoes(state: PersistedState) {
  return {
    version: state.version,
    library: {
      echoes: state.library.echoes,
    },
  }
}

function makeInvBuilds(state: PersistedState) {
  return {
    version: state.version,
    library: {
      builds: state.library.builds,
    },
  }
}

function makeInvRotSlice(state: PersistedState) {
  return {
    version: state.version,
    library: {
      rotations: state.library.rotations,
    },
  }
}

function makeInvScenarioSlice(state: PersistedState) {
  return {
    version: state.version,
    library: {
      scenarios: state.library.scenarios,
    },
  }
}

type PersistSpecMap = {
  'ui.appearance': PersistSpec<ReturnType<typeof makeAppearance>>
  'ui.showcaseCards': PersistSpec<{ cards: PersistedState['ui']['preferences']['showcaseCards'] }>
  'ui.layout': PersistSpec<ReturnType<typeof makeLayout>>
  'ui.savedRotationPreferences': PersistSpec<ReturnType<typeof makeRotPrefs>>
  'combat.workspace': PersistSpec<ReturnType<typeof makeCombatWorkspace>>
  'simulation.optimizerSettings': PersistSpec<ReturnType<typeof makeOptSettingsSlice>>
  'simulation.suggestions': PersistSpec<ReturnType<typeof makeSuggestSlice>>
  'library.echoes': PersistSpec<ReturnType<typeof makeInvEchoes>>
  'library.builds': PersistSpec<ReturnType<typeof makeInvBuilds>>
  'library.rotations': PersistSpec<ReturnType<typeof makeInvRotSlice>>
  'library.scenarios': PersistSpec<ReturnType<typeof makeInvScenarioSlice>>
}

type PrssDmnSlc<K extends PersistKey> =
  PersistSpecMap[K] extends PersistSpec<infer TSlice> ? TSlice : never

const DOMAIN_SPECS: PersistSpecMap = {
  'ui.showcaseCards': {
    label: 'Showcase cards', storageKey: SHOWCASE_INDEX,
    schema: { safeParse: (value: unknown) => ({ success: true as const, data: value }) },
    build: (state) => ({ cards: state.ui.preferences.showcaseCards }),
    apply: (state, slice) => { state.ui = { ...state.ui, preferences: { ...DEF_UI_PREFS, ...state.ui.preferences, showcaseCards: slice.cards } } },
  },
  'ui.appearance': {
    label: 'ui appearance',
    storageKey: APPSTOREUIPP,
    schema: prssUiPprnSl,
    build: makeAppearance,
    apply: (state, slice) => {
      state.ui = {
        ...state.ui,
        ...slice.ui,
      }
    },
  },
  'ui.layout': {
    label: 'ui layout',
    storageKey: APPSTOREUILY,
    schema: prssUiLytSlc,
    build: makeLayout,
    apply: (state, slice) => {
      state.ui = {
        ...state.ui,
        ...slice.ui,
      }
    },
  },
  'ui.savedRotationPreferences': {
    label: 'ui saved rotation preferences',
    storageKey: APPSTOREUISV,
    schema: prssUiSvdRoh,
    build: makeRotPrefs,
    apply: (state, slice) => {
      state.ui = {
        ...state.ui,
        ...slice.ui,
      }
    },
  },
  'combat.workspace': {
    label: 'combat workspace',
    storageKey: APPSTORECMBT,
    schema: prssCmbtWrkspSlcS,
    build: makeCombatWorkspace,
    apply: (state, slice) => {
      state.combat = slice.combat
    },
  },
  'simulation.optimizerSettings': {
    label: 'optimizer settings',
    storageKey: APPSTOREOPTS,
    schema: prssOptSettingsSl,
    build: makeOptSettingsSlice,
    apply: (state, slice) => {
      state.simulation = {
        ...state.simulation,
        optimizerSettingsResonatorId: slice.simulation.optimizerSettingsResonatorId,
        optimizerSettings: slice.simulation.optimizerSettings,
      }
    },
  },
  'simulation.suggestions': {
    label: 'suggestions',
    storageKey: SUGG_STORE_KEY,
    schema: prssSuggsSlc,
    build: makeSuggestSlice,
    apply: (state, slice) => {
      state.simulation = {
        ...state.simulation,
        weaponSuggests: slice.simulation.weaponSuggests,
        suggestionsByResonatorId: slice.simulation.suggestionsByResonatorId,
      }
    },
  },
  'library.echoes': {
    label: 'inventory echoes',
    storageKey: APPSTOREINVC,
    schema: prssInvChsSl,
    build: makeInvEchoes,
    apply: (state, slice) => {
      state.library = {
        ...state.library,
        echoes: slice.library.echoes,
      }
    },
  },
  'library.builds': {
    label: 'inventory builds',
    storageKey: APPSTOREINVB,
    schema: prssInvBldsS,
    build: makeInvBuilds,
    apply: (state, slice) => {
      state.library = {
        ...state.library,
        builds: slice.library.builds,
      }
    },
  },
  'library.rotations': {
    label: 'inventory rotations',
    storageKey: APPSTOREINVR,
    schema: prssInvRttnS,
    build: makeInvRotSlice,
    apply: (state, slice) => {
      state.library = {
        ...state.library,
        rotations: slice.library.rotations,
      }
    },
  },
  'library.scenarios': {
    label: 'saved scenarios',
    storageKey: APPSTOREINVS,
    schema: prssInvScenariosSl,
    build: makeInvScenarioSlice,
    apply: (state, slice) => {
      state.library = {
        ...state.library,
        scenarios: slice.library.scenarios,
      }
    },
  },
}

function getPrssDmnKe(includeInventory: boolean | 'gear'): PersistKey[] {
  if (includeInventory === 'gear') return [...NONINVDMNKEY, ...GEAR_DOMAIN_KEYS]
  return includeInventory
    ? ALL_DOMAIN_KEYS
    : NONINVDMNKEY
}

function hasCurStoreE(): boolean {
  return localStorage.getItem(APPSTORECMBTINDEX) != null
    || ALL_DOMAIN_KEYS.some((key) => localStorage.getItem(DOMAIN_SPECS[key].storageKey) != null)
}

function qrntStoreKey(key: string, raw: string): void {
  localStorage.setItem(`${APPSTORERCVR}.${Date.now()}.${key}`, raw)
  localStorage.removeItem(key)
}

function readVldtStor<T>(
  raw: string,
  schema: PrssDmnSchm,
  label: string,
): T {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${label} is not valid JSON.`)
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`${label} validation failed.`)
  }

  return result.data as T
}

function readPrssDmn<K extends PersistKey>(
  key: K,
  loadedJson?: Map<PersistKey, string>,
): PrssDmnSlc<K> | null {
  if (key === 'ui.showcaseCards') {
    const cards = readShowcaseCards()
    return cards ? { cards } as PrssDmnSlc<K> : null
  }
  if (key === 'combat.workspace') {
    const indexed = readCombatWorkspace()
    if (indexed) return indexed as PrssDmnSlc<K>
  }
  const spec = DOMAIN_SPECS[key]
  const raw = localStorage.getItem(spec.storageKey)
  if (!raw) {
    return null
  }

  try {
    const json = decodePersistedDomain(key, raw)
    const slice = readVldtStor<PrssDmnSlc<K>>(json, spec.schema, spec.label)
    // plain rotations still need their one-time compression migration. retain
    // other decoded payloads only for this load, to detect real repair writes.
    if (key !== 'library.rotations' || raw.startsWith(COMPRESSED_ROTATIONS_PREFIX)) {
      loadedJson?.set(key, json)
    }
    return slice
  } catch (error) {
    console.warn(`[storage] failed to parse ${spec.label}`, error)
    try {
      qrntStoreKey(spec.storageKey, raw)
    } catch (rcvrRrr) {
      console.warn(`[storage] failed to quarantine invalid ${spec.label}`, rcvrRrr)
    }
    return null
  }
}

function makePersistDraft(includeInventory: boolean): PersistDraft {
  const defaults = makeAppState()

  return {
    version: APP_STATE_VER,
    combat: defaults.combat,
    ui: {
      ...defaults.ui,
    },
    simulation: { ...defaults.simulation },
    library: includeInventory
      ? defaults.library
      : { echoes: [], builds: [], rotations: [], scenarios: [] },
  }
}

function normPrssAppS(parsed: unknown): HydratedAppState {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Snapshot must be a JSON object.')
  }

  const current = persistedSchema.safeParse(parsed)
  if (current.success) {
    return initAppState(current.data as unknown as PersistedState)
  }

  throw new Error('Snapshot validation failed.')
}

function normalizeAppState(
  state: PersistedUnknown,
): HydratedAppState {
  const indexed = state.combat as ScenarioWorkspace | undefined
  if (indexed?.summaryById && indexed.order.some((id) =>
    Boolean(Object.getOwnPropertyDescriptor(indexed.scenariosById, id)?.get))) {
    const selectedId = indexed.selectedScenarioId
    const selected = indexed.scenariosById[selectedId]
    const normalized = initAppState({
      ...state,
      combat: {
        selectedScenarioId: selectedId,
        order: [selectedId],
        scenariosById: { [selectedId]: selected },
      },
    })
    const selectedNormalized = normalized.combat.scenariosById[selectedId]
    const scenariosById = copyScenarioRecords(indexed.scenariosById)
    Object.defineProperty(scenariosById, selectedId, {
      value: selectedNormalized,
      enumerable: true,
      configurable: true,
      writable: true,
    })
    return {
      ...normalized,
      combat: {
        selectedScenarioId: selectedId,
        order: indexed.order,
        scenariosById,
        summaryById: {
          ...indexed.summaryById,
          [selectedId]: summarizeScenario(selectedNormalized),
        },
      },
    }
  }
  return initAppState(state)
}

function ssmbPrssAppS(includeInventory: boolean | 'gear'): HydratedAppState | null {
  const state = makePersistDraft(Boolean(includeInventory))
  const loadedDomains: PersistKey[] = []
  let hasLddDmn = false

  for (const key of getPrssDmnKe(includeInventory)) {
    const domain = readPrssDmn(key)
    if (!domain) {
      continue
    }

    DOMAIN_SPECS[key].apply(state, domain)
    loadedDomains.push(key)
    hasLddDmn = true
  }

  if (!hasLddDmn) {
    return readMonolithicState({ parsePersisted, saveAppState, quarantine: qrntStoreKey }) ?? readLegacyState({ parsePersisted, saveAppState, quarantine: qrntStoreKey })
  }

  const normalState = normalizeAppState(state)
  const hadIndexedCombat = loadedDomains.includes('combat.workspace')
    && scenarioRecords.hasCurrentManifest()
  saveAppState(normalState, {
    domains: hadIndexedCombat
      ? loadedDomains.filter((key) => key !== 'combat.workspace')
      : loadedDomains,
  })
  if (hadIndexedCombat) scenarioRecords.rememberWorkspaceRefs(normalState.combat)
  return normalState
}

// parse persisted app state from raw json text
export function parsePersisted(raw: string): HydratedAppState {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Snapshot is not valid JSON.')
  }

  return normPrssAppS(parsed)
}

// gear supports equipped-status checks throughout the app; saved snapshots are opt-in.
export function loadPrssAppS(
  options: { includeInventory?: boolean | 'gear' } = {},
): HydratedAppState | null {
  const includeInventory = options.includeInventory ?? true

  const loaded = hasCurStoreE()
    ? ssmbPrssAppS(includeInventory)
    : readMonolithicState({ parsePersisted, saveAppState, quarantine: qrntStoreKey }) ?? readLegacyState({ parsePersisted, saveAppState, quarantine: qrntStoreKey })
  if (!loaded || includeInventory === true) return loaded
  // legacy migration persists the complete library before trimming resident data.
  return {
    ...loaded,
    library: {
      echoes: includeInventory === 'gear' ? loaded.library.echoes : [],
      builds: includeInventory === 'gear' ? loaded.library.builds : [],
      rotations: [],
      scenarios: [],
    },
  }
}

export function loadPrssInvS(scope: 'gear' | 'saved' | 'all' = 'all'): PersistedState['library'] {
  const domains = scope === 'gear' ? GEAR_DOMAIN_KEYS
    : scope === 'saved' ? SAVED_ROTATION_DOMAIN_KEYS : INV_DOMAIN_KEYS
  const state = makePersistDraft(true)
  const loadedJson = new Map<PersistKey, string>()
  let hasLddInv = false

  for (const key of domains) {
    const domain = readPrssDmn(key, loadedJson)
    if (!domain) {
      continue
    }

    DOMAIN_SPECS[key].apply(state, domain)
    hasLddInv = true
  }

  if (!hasLddInv && scope === 'all' && !hasCurStoreE()) {
    const migrated = readMonolithicState({ parsePersisted, saveAppState, quarantine: qrntStoreKey }) ?? readLegacyState({ parsePersisted, saveAppState, quarantine: qrntStoreKey })
    if (migrated) {
      return migrated.library
    }

    return { echoes: [], builds: [], rotations: [], scenarios: [] }
  }

  const normalState = normalizeAppState(state)
  // hydration runs again after inventory eviction. recompressing and rewriting
  // every unchanged rotation here used to block the next modal's open handler.
  // compare the same validated shape that persistence writes; catalog repairs
  // and encoding migrations still reach storage, once, through the usual path.
  const changedDomains = domains.filter((key) => {
    const spec = DOMAIN_SPECS[key]
    const result = spec.schema.safeParse(spec.build(normalState))
    return !result.success || loadedJson.get(key) !== JSON.stringify(result.data)
  })
  if (changedDomains.length > 0) {
    saveAppState(normalState, { domains: changedDomains })
  }

  return normalState.library
}

// validate and save persisted app state domains
export function saveAppState(
  state: PersistedState,
  options: { domains?: PersistKey[] } = {},
): boolean {
  // ordinary store writes already pass canonical state. normalizing the whole
  // application here used to clone/rebuild every scenario and inventory domain
  // even when one small domain was dirty. keep full normalization for the
  // migration/recovery path (no explicit domains), and validate only the
  // requested slices for routine writes.
  let persistedState: PersistedState = state
  if (!options.domains) {
    try {
      persistedState = normalizeAppState(state as unknown as PersistedUnknown)
    } catch (error) {
      console.warn('[storage] failed to normalize app state for persistence', error)
      return false
    }
  }

  let succeeded = true
  const domains = new Set(options.domains ?? ALL_DOMAIN_KEYS)
  // always migrate cards before a layout write can remove their legacy copy.
  if (domains.has('ui.layout') || domains.has('ui.showcaseCards')) {
    try { writeShowcaseCards(persistedState.ui.preferences.showcaseCards) }
    catch (error) {
      console.warn('[storage] failed to persist Showcase cards', error)
      succeeded = false
      domains.delete('ui.layout')
    }
    domains.delete('ui.showcaseCards')
  }
  for (const key of domains) {
    if (key === 'combat.workspace') {
      try {
        writeCombatWorkspace(persistedState.combat)
      } catch (error) {
        console.warn('[storage] failed to persist combat workspace', error)
        succeeded = false
      }
      continue
    }
    const spec = DOMAIN_SPECS[key]
    const slice = spec.build(persistedState)
    const result = spec.schema.safeParse(slice)
    if (!result.success) {
      console.error(`[storage] refusing to save invalid ${spec.label}`, result.error)
      succeeded = false
      continue
    }

    try {
      localStorage.setItem(spec.storageKey, encodePersistedDomain(key, result.data))
    } catch (error) {
      console.warn(`[storage] failed to persist ${spec.label}`, error)
      succeeded = false
    }
  }

  try {
    localStorage.removeItem(RETIRED_SESSION_STORE_KEY)
  } catch (error) {
    console.warn('[storage] failed to remove retired session state', error)
  }
  return succeeded
}

export function markPrssDmns(keys: PersistKey[]): void {
  persistenceCoordinator.mark(keys)
}

export function consumePersist(): PersistKey[] {
  return persistenceCoordinator.consume()
}

export function sbscToDrtyPr(listener: () => void): () => void {
  return persistenceCoordinator.subscribe(listener)
}

// clear persisted app state entries
export function clrPrssAppSt(): void {
  clearShowcaseCards()
  persistenceCoordinator.clear()
  localStorage.removeItem(APP_STORAGE_KEY)
  localStorage.removeItem(RETIRED_SESSION_STORE_KEY)
  localStorage.removeItem(APPSTOREPRFL)

  for (const key of ALL_DOMAIN_KEYS) {
    localStorage.removeItem(DOMAIN_SPECS[key].storageKey)
  }

  if (typeof localStorage.key !== 'function') {
    return
  }

  const recoveryKeys: string[] = []

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(`${APPSTORERCVR}.`)) {
      recoveryKeys.push(key)
    }
  }

  for (const key of recoveryKeys) {
    localStorage.removeItem(key)
  }
}
