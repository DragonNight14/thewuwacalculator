/*
  Author: Runor Ewhro
  Description: locks persistence and import compatibility across legacy backup
               shapes, current partial exports, and split-storage dirty-domain
               routing.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import type { EchoInstance } from '@/domain/entities/runtime'
import { makeEchoUid } from '@/domain/entities/runtime'
import { getEchoNstnSig } from '@/domain/entities/inventoryStorage'
import type { RotationNode } from '@/domain/gameData/contracts'
import { listEchoes } from '@/domain/services/echoCatalogService'
import { getWeaponById, listWeaponsByType } from '@/domain/services/catalogService'
import { importLegacyInventoryEchoJson } from '@/domain/services/legacyInventoryImport'
import { importLegacyApp } from '@/domain/services/legacyAppStateImport'
import { listResSds, resSdsById } from '@/domain/services/resonatorSeedService'
import {
  DEF_RES_ID,
  initAppState,
  makeAppState,
  makeResProfile,
  makeResRuntime,
  makeSuggest,
  makeTeamMember,
  mkDefTeamMem,
} from '@/domain/state/defaults'
import { applyPckrFre, normalizePckrFreqState } from '@/domain/state/pickerFrequency'
import { mkInitRtLkp, mkWorkRtBndl } from '@/domain/state/runtimeAdapters'
import { persistedSchema } from '@/domain/state/schema'
import { useAppStore } from '@/domain/state/store'
import { APP_STORAGE_KEY, clrPrssAppSt, consumePersist, loadPrssAppS, parsePersisted } from '@/infra/persistence/storage'
import { mkDataXprtFi, resMprtData } from '@/modules/settings/model/dataManagement'

const prodAppLoaders = import.meta.glob('../../../../prod-app.json', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

const loadProdApp = prodAppLoaders['../../../../prod-app.json']

function makeMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => {
      values.clear()
    },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  } as Storage
}

function makeCatalogEcho(uid: string, echoId = listEchoes()[0]?.id) {
  // legacy backups store catalog-shaped echoes, so the fixture starts from the
  // real catalog instead of hand-writing ids that could drift from generated data
  const definition = listEchoes().find((echo) => echo.id === echoId)
  if (!definition) {
    throw new Error(`missing echo fixture ${echoId}`)
  }

  const primaryStats = ECHO_MAIN_STATS[definition.cost]
  const secondaryStat = ECHO_SIDE_STATS[definition.cost]
  const primaryKey = Object.keys(primaryStats)[0]

  return {
    uid,
    id: definition.id,
    set: definition.sets[0] ?? 0,
    mainStats: {
      primary: {
        key: primaryKey,
        value: primaryStats[primaryKey],
      },
      secondary: {
        key: secondaryStat.key,
        value: secondaryStat.value,
      },
    },
    substats: {
      critRate: 6.3,
      critDmg: 12.6,
    },
  }
}

function getFixtureSeed() {
  const seed = listResSds()[0]
  if (!seed) {
    throw new Error('missing resonator fixture')
  }
  return seed
}

function getFixtureWeaponId() {
  const seed = getFixtureSeed()
  return seed.defaultWeaponId ?? listWeaponsByType(seed.weaponType)[0]?.id ?? null
}

function makeLegacyBackupRaw() {
  // this mirrors the old all-data export envelope: runtime profile data lived
  // under charInfo while inventories and presets lived under stores
  const seed = getFixtureSeed()
  const weaponId = getFixtureWeaponId()

  return JSON.stringify({
    charInfo: {
      activeCharacterId: seed.id,
      enemyLevel: 95,
      enemyRes: 15,
      characterRuntimeStates: {
        [seed.id]: {
          Id: seed.id,
          CharacterLevel: 90,
          SkillLevels: {
            sequence: 6,
            normalAttack: 9,
            resonanceSkill: 8,
            forteCircuit: 7,
            resonanceLiberation: 6,
            introSkill: 5,
          },
          TraceNodeBuffs: {
            atkPercent: 12,
            [seed.attribute]: 12,
          },
          CombatState: {
            weaponId,
            weaponLevel: 90,
            weaponRank: 5,
          },
          equippedEchoes: [makeCatalogEcho('equipped-echo')],
        },
      },
    },
    controls: {
      'user-theme': 'dark',
      leftPaneView: 'characters',
      showOptimizer: true,
    },
    stores: {
      echoBag: [
        makeCatalogEcho('bag-echo-1'),
        makeCatalogEcho('bag-echo-2'),
      ],
      echoPresets: [
        {
          id: 'preset-1',
          name: `Imported ${seed.name}`,
          charId: seed.id,
          charName: seed.name,
          echoes: [makeCatalogEcho('preset-echo')],
        },
      ],
    },
  })
}

function makeInventoryEchoInstance(echoId: string, slotIndex = 0): EchoInstance {
  // current partial imports operate on runtime echo instances, so this fixture
  // keeps generated main-stat values while assigning a fresh runtime uid
  const definition = listEchoes().find((echo) => echo.id === echoId)
  if (!definition) {
    throw new Error(`missing echo ${echoId}`)
  }

  const primaryStats = ECHO_MAIN_STATS[definition.cost]
  const secondaryStat = ECHO_SIDE_STATS[definition.cost]
  const primaryKey = Object.keys(primaryStats)[0]

  return {
    uid: makeEchoUid(),
    id: definition.id,
    set: definition.sets[0] ?? 0,
    mainEcho: slotIndex === 0,
    mainStats: {
      primary: { key: primaryKey, value: primaryStats[primaryKey] },
      secondary: { key: secondaryStat.key, value: secondaryStat.value },
    },
    substats: {
      critRate: 6.3,
      critDmg: 12.6,
    },
  }
}

function makeUnknownEchoInstance(slotIndex = 0): EchoInstance {
  const echo = makeInventoryEchoInstance(listEchoes()[0].id, slotIndex)
  return {
    ...echo,
    id: 'beta-only-echo',
    set: 999999,
  }
}

function expectDerivedRuntimeRefsAreLive(state: ReturnType<typeof initAppState>) {
  const liveEchoes = new Map(listEchoes().map((echo) => [echo.id, echo]))
  const expectKnownResonator = (id: string | null | undefined) => {
    expect(id ? resSdsById[id] : null).toBeDefined()
  }
  const expectKnownWeapon = (id: string | null | undefined) => {
    if (id) {
      expect(getWeaponById(id)).toBeTruthy()
    }
  }
  const expectKnownEcho = (echo: EchoInstance | null | undefined) => {
    if (!echo) {
      return
    }

    const definition = liveEchoes.get(echo.id)
    expect(definition).toBeDefined()
    expect(definition?.sets).toContain(echo.set)
  }

  const runtimeViews = {
    ...mkInitRtLkp(state.calculator),
    ...mkWorkRtBndl(state.calculator).partRtsById,
  }

  for (const [resonatorId, runtime] of Object.entries(runtimeViews)) {
    expectKnownResonator(resonatorId)
    expectKnownWeapon(runtime.build.weapon.id)
    runtime.build.echoes.forEach(expectKnownEcho)
    runtime.build.team.forEach((teamId) => {
      if (teamId) expectKnownResonator(teamId)
    })
  }
}

describe('storage compatibility', () => {
  it('uses the catalog default weapon when instantiating resonator state', () => {
    const expectConstructorsUseWeapon = (seed: NonNullable<ReturnType<typeof listResSds>[number]>, weaponId: string | null) => {
      expect(makeResProfile(seed).runtime.build.weapon.id).toBe(weaponId)
      expect(makeResRuntime(seed).build.weapon.id).toBe(weaponId)
      expect(mkDefTeamMem(seed).build.weapon.id).toBe(weaponId)
      expect(makeTeamMember(seed).build.weapon.id).toBe(weaponId)
    }

    const seed = listResSds().find((entry) => entry.defaultWeaponId)
    expect(seed?.defaultWeaponId).toBeTruthy()
    expectConstructorsUseWeapon(seed!, seed!.defaultWeaponId)

    const fallbackSeed = listResSds().find((entry) => !entry.defaultWeaponId)
    if (!fallbackSeed) {
      return
    }

    expectConstructorsUseWeapon(
      fallbackSeed,
      listWeaponsByType(fallbackSeed.weaponType)[0]?.id ?? '0',
    )
  })

  it.runIf(Boolean(loadProdApp))('hydrates the current production snapshot without clearing saved state', async () => {
    const raw = await loadProdApp!()
    const parsed = JSON.parse(raw) as unknown
    const before = parsed as {
      calculator?: {
        profiles?: Record<string, unknown>
        inventoryEchoes?: unknown[]
        inventoryBuilds?: unknown[]
        inventoryRotations?: unknown[]
      }
    }

    const schemaResult = persistedSchema.safeParse(parsed)
    expect(schemaResult.success).toBe(true)

    const parsedState = parsePersisted(raw)
    const hydrated = initAppState(parsedState)
    const profileCount = Object.keys(before.calculator?.profiles ?? {}).length
    const echoCount = before.calculator?.inventoryEchoes?.length ?? 0
    const buildCount = before.calculator?.inventoryBuilds?.length ?? 0
    const rotationCount = before.calculator?.inventoryRotations?.length ?? 0

    expect(hydrated.version).toBe(22)
    expect(Object.keys(hydrated.calculator.profiles)).toHaveLength(profileCount)
    expect(hydrated.calculator.inventoryEchoes).toHaveLength(echoCount)
    expect(hydrated.calculator.inventoryBuilds).toHaveLength(buildCount)
    expect(hydrated.calculator.inventoryRotations).toHaveLength(rotationCount)

    const lynaeProfile = hydrated.calculator.profiles['1509']
    expect(lynaeProfile).toBeDefined()
    const invByUid = new Map(
      hydrated.calculator.inventoryEchoes.map((entry) => [entry.echo.uid, entry.echo] as const),
    )
    for (const echo of lynaeProfile!.runtime.build.echoes) {
      expect(echo).not.toBeNull()
      const inventoryEcho = invByUid.get(echo!.uid)
      expect(inventoryEcho).toBeDefined()
      expect(getEchoNstnSig(inventoryEcho!)).toBe(getEchoNstnSig(echo!))
    }

    // production users still carrying the old monolithic key should be migrated
    // into split domain keys instead of falling back to a cleared default state
    vi.stubGlobal('localStorage', makeMemoryStorage())
    try {
      clrPrssAppSt()
      localStorage.setItem(APP_STORAGE_KEY, raw)
      const loaded = loadPrssAppS()
      expect(loaded).not.toBeNull()
      expect(Object.keys(loaded?.calculator.profiles ?? {})).toHaveLength(profileCount)
      expect(loaded?.calculator.inventoryEchoes).toHaveLength(echoCount)
      expect(loaded?.calculator.inventoryBuilds).toHaveLength(buildCount)
      expect(loaded?.calculator.inventoryRotations).toHaveLength(rotationCount)
      expect(localStorage.getItem(APP_STORAGE_KEY)).toBeNull()
      clrPrssAppSt()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('imports the legacy all-data backup shape into inventory echoes and a persisted snapshot', () => {
    const raw = makeLegacyBackupRaw()
    const inventory = importLegacyInventoryEchoJson(raw)
    const imported = importLegacyApp(raw)
    const seed = getFixtureSeed()

    expect(inventory.importedCount).toBe(2)
    expect(inventory.skippedCount).toBe(0)
    expect(inventory.echoes.map((echo) => echo.uid)).toEqual(['bag-echo-1', 'bag-echo-2'])

    // imported app snapshots should land directly on the current persisted
    // version so production hydration does not clear valid legacy backups
    expect(imported.snapshot.version).toBe(22)
    expect(imported.snapshot.ui.theme).toBe('dark')
    expect(imported.snapshot.ui.leftPaneView).toBe('resonators')
    expect(imported.snapshot.ui).not.toHaveProperty('mainMode')
    expect(imported.snapshot.calculator.session.activeResonatorId).toBe(seed.id)
    expect(Object.keys(imported.snapshot.calculator.profiles)).toEqual([seed.id])
    expect(imported.snapshot.calculator.inventoryEchoes).toHaveLength(2)
    expect(imported.snapshot.calculator.inventoryBuilds).toHaveLength(1)
    expect(imported.snapshot.calculator.inventoryRotations).toHaveLength(0)

    const importedProfile = imported.snapshot.calculator.profiles[seed.id]
    const defaultProfile = makeResProfile(seed)
    expect(importedProfile.runtime.progression.level).toBe(90)
    expect(importedProfile.runtime.progression.sequence).toBe(6)
    expect(importedProfile.runtime.progression.traceNodes.atk.percent).toBe(12)
    expect(importedProfile.runtime.progression.traceNodes.attribute[seed.attribute].dmgBonus).toBe(12)
    expect(importedProfile.runtime.build.weapon.id).toBe(getFixtureWeaponId())
    expect(importedProfile.runtime.build.echoes).toHaveLength(1)
    expect(importedProfile.runtime.local.controls).toEqual(defaultProfile.runtime.local.controls)
    expect(importedProfile.runtime.local.combat).toEqual(defaultProfile.runtime.local.combat)
    expect(importedProfile.runtime.rotation).toEqual(defaultProfile.runtime.rotation)

    expect(imported.report.importedProfileIds).toEqual([seed.id])
    expect(imported.report.skippedProfileIds).toHaveLength(0)
    expect(imported.report.importedInventoryEchoes).toBe(2)
    expect(imported.report.importedInventoryBuilds).toBe(1)
    expect(imported.report.importedInventoryRotations).toBe(0)
  })

  it('strips legacy persisted fields and hydrates current derived names on load', () => {
    const state = makeAppState()
    const resonatorId = DEF_RES_ID
    const seed = resSdsById[resonatorId]
    expect(seed).toBeDefined()
    state.calculator.profiles[resonatorId] = makeResProfile(seed!)

    const raw = structuredClone(state)
    const rawProfile = raw.calculator.profiles[resonatorId]
    type LegacyWeapon = typeof rawProfile.runtime.build.weapon & { baseAtk?: number }
    ;(rawProfile.runtime.build.weapon as LegacyWeapon).baseAtk = 12345
    raw.calculator.inventoryBuilds.push({
      id: 'legacy-build',
      name: 'Legacy Build',
      resonatorId,
      resonatorName: 'Legacy',
      build: {
        weapon: {
          id: rawProfile.runtime.build.weapon.id,
          level: 90,
          rank: 1,
          baseAtk: 12345,
        } as LegacyWeapon,
        echoes: [null, null, null, null, null],
      },
      createdAt: 1,
      updatedAt: 1,
    })
    raw.calculator.inventoryRotations.push({
      id: 'legacy-rotation',
      name: 'Legacy Rotation',
      mode: 'team',
      resonatorId,
      resonatorName: 'Legacy',
      duration: 10,
      note: '',
      team: [resonatorId, null, null],
      items: [],
      summary: {
        total: { normal: 1, avg: 1, crit: 1 },
        members: [
          {
            id: resonatorId,
            name: 'Legacy',
            contribution: { normal: 1, avg: 1, crit: 1 },
          },
        ],
      },
      createdAt: 1,
      updatedAt: 1,
    })

    // parsing strips data that is now derived from catalogs; initAppState then
    // rehydrates those display fields from the current generated source of truth
    const parsed = persistedSchema.parse(raw)

    expect(parsed.calculator.profiles[resonatorId]?.runtime.build.weapon).not.toHaveProperty('baseAtk')
    expect(parsed.calculator.inventoryBuilds[0]?.build.weapon).not.toHaveProperty('baseAtk')
    expect(parsed.calculator.inventoryBuilds[0]).not.toHaveProperty('resonatorName')
    expect(parsed.calculator.inventoryRotations[0]).not.toHaveProperty('resonatorName')
    expect(parsed.calculator.inventoryRotations[0]?.summary?.members?.[0]).not.toHaveProperty('name')

    const hydrated = initAppState(parsed as unknown as Parameters<typeof initAppState>[0])
    expect(hydrated.calculator.profiles[resonatorId].runtime.build.weapon.baseAtk).toBeGreaterThan(0)
    expect(hydrated.calculator.inventoryBuilds[0].resonatorName).toBe(seed!.name)
    expect(hydrated.calculator.inventoryRotations[0].resonatorName).toBe(seed!.name)
    expect(hydrated.calculator.inventoryRotations[0].summary?.members?.[0]?.name).toBe(seed!.name)
  })

  it('preserves stale catalog entries while deriving safe live runtime defaults', () => {
    const seed = resSdsById[DEF_RES_ID] ?? getFixtureSeed()
    const validWeaponId = seed.defaultWeaponId ?? listWeaponsByType(seed.weaponType)[0]?.id ?? null
    const validEchoDefinition = listEchoes()[0]
    const validEcho = makeInventoryEchoInstance(validEchoDefinition.id)
    const wrongSetEcho = {
      ...makeInventoryEchoInstance(validEchoDefinition.id, 1),
      set: 999999,
    }
    const invalidResonatorId = 'beta-only-resonator'
    const invalidWeaponId = 'beta-only-weapon'
    const invalidEnemyId = 'beta-only-enemy'
    const invalidSetId = 999999
    const invalidFeatureNode: RotationNode = {
      id: 'missing-feature-node',
      type: 'feature',
      featureId: 'beta-only-feature',
      multiplier: 1,
      enabled: true,
    }
    const invalidSnapshot = makeResProfile(seed)
    invalidSnapshot.resonatorId = invalidResonatorId

    const raw = structuredClone(makeAppState())
    const profile = makeResProfile(seed)
    profile.runtime.team = [seed.id, invalidResonatorId, seed.id]
    profile.runtime.teamRuntimes = [{
      ...makeTeamMember(seed),
      id: invalidResonatorId,
    }, null]
    profile.runtime.build.weapon = {
      id: invalidWeaponId,
      level: 90,
      rank: 5,
      baseAtk: 12345,
    }
    profile.runtime.build.echoes = [makeUnknownEchoInstance(), wrongSetEcho, null, null, null]
    profile.runtime.local.setConditionals = {
      ...profile.runtime.local.setConditionals,
      off: {
        [String(invalidSetId)]: ['beta-only-part'],
        [String(validEchoDefinition.sets[0])]: ['known-part'],
      },
    }
    profile.runtime.rotation.personalItems = [invalidFeatureNode]
    profile.runtime.routing.selectedTargetsByOwnerKey = {
      owner: invalidResonatorId,
    }

    raw.calculator.profiles = {
      [seed.id]: profile,
      [invalidResonatorId]: invalidSnapshot,
    }
    raw.calculator.session.activeResonatorId = invalidResonatorId
    raw.calculator.session.enemyProfile = {
      ...raw.calculator.session.enemyProfile,
      id: invalidEnemyId,
      source: 'catalog',
    }
    raw.calculator.inventoryEchoes = [
      {
        id: 'stale-inventory-echo',
        echo: makeUnknownEchoInstance(),
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'kept-inventory-echo',
        echo: wrongSetEcho,
        createdAt: 2,
        updatedAt: 2,
      },
    ]
    raw.calculator.inventoryBuilds = [
      {
        id: 'stale-build-owner',
        name: 'Stale owner',
        resonatorId: invalidResonatorId,
        resonatorName: 'Beta only',
        build: {
          weapon: { id: invalidWeaponId, level: 90, rank: 5, baseAtk: 12345 },
          echoes: [makeUnknownEchoInstance(), null, null, null, null],
        },
        createdAt: 3,
        updatedAt: 3,
      },
      {
        id: 'kept-build',
        name: 'Kept build',
        resonatorId: seed.id,
        resonatorName: 'Old name',
        build: {
          weapon: { id: invalidWeaponId, level: 90, rank: 5, baseAtk: 12345 },
          echoes: [makeUnknownEchoInstance(), validEcho, null, null, null],
        },
        createdAt: 4,
        updatedAt: 4,
      },
    ]
    raw.calculator.inventoryRotations = [
      {
        id: 'stale-rotation-owner',
        name: 'Stale rotation',
        mode: 'personal',
        resonatorId: invalidResonatorId,
        resonatorName: 'Beta only',
        duration: 10,
        note: '',
        items: [invalidFeatureNode],
        createdAt: 5,
        updatedAt: 5,
      },
      {
        id: 'kept-rotation',
        name: 'Kept rotation',
        mode: 'team',
        resonatorId: seed.id,
        resonatorName: 'Old name',
        duration: 10,
        note: '',
        team: [seed.id, invalidResonatorId, null],
        items: [invalidFeatureNode],
        snapshot: invalidSnapshot,
        summary: {
          total: { normal: 1, avg: 1, crit: 1 },
          members: [
            {
              id: invalidResonatorId,
              name: 'Beta only',
              contribution: { normal: 1, avg: 1, crit: 1 },
            },
            {
              id: seed.id,
              name: 'Old name',
              contribution: { normal: 2, avg: 2, crit: 2 },
            },
          ],
        },
        createdAt: 6,
        updatedAt: 6,
      },
    ]
    raw.calculator.optimizerContext = {
      resonatorId: invalidResonatorId,
      runtime: makeResRuntime(seed),
      sourceRuntimeSig: '',
      settings: {
        targetSkillId: null,
        targetMode: 'skill',
        targetComboSourceId: null,
        rotationMode: false,
        searchMode: 'inventory',
        resultsLimit: 128,
        keepPercent: 0,
        lowMemoryMode: false,
        enableGpu: true,
        lockedMainEchoId: null,
        allowedSets: {
          1: [invalidSetId],
          3: [invalidSetId],
          5: [invalidSetId],
        },
        mainStatFilter: [],
        selectedBonus: null,
        excludeEquipped: false,
        includeWeapons: false,
        statConstraints: {},
      },
    }
    raw.calculator.weaponSuggests.states = {
      [invalidWeaponId]: { staleState: { max: true } },
      ...(validWeaponId ? { [validWeaponId]: { knownState: { max: 1 } } } : {}),
    }
    raw.calculator.suggestionsByResonatorId = {
      [invalidResonatorId]: makeSuggest(),
      [seed.id]: {
        settings: {
          targetFeatureId: 'beta-only-feature',
          rotationMode: false,
        },
        random: {
          bias: 0.5,
          rollQuality: 0.3,
          targetEnergyRegen: 0,
          setPreferences: [
            { setId: invalidSetId, count: 5 },
            { setId: validEchoDefinition.sets[0], count: 2 },
          ],
          mainEchoId: 'beta-only-echo',
        },
      },
    }

    const hydrated = initAppState(raw as unknown as Parameters<typeof initAppState>[0])
    const hydratedProfile = hydrated.calculator.profiles[seed.id]
    const workspace = mkWorkRtBndl(hydrated.calculator)
    const activeRuntime = workspace.actRt

    expect(hydrated.calculator.session.activeResonatorId).toBe(seed.id)
    expect(Object.keys(hydrated.calculator.profiles).sort()).toEqual([invalidResonatorId, seed.id].sort())
    expect(hydratedProfile.runtime.team).toEqual([seed.id, invalidResonatorId, seed.id])
    expect(hydratedProfile.runtime.teamRuntimes[0]?.id).toBe(invalidResonatorId)
    expect(hydratedProfile.runtime.build.weapon.id).toBe(invalidWeaponId)
    expect(hydratedProfile.runtime.build.echoes[0]?.id).toBe('beta-only-echo')
    expect(hydratedProfile.runtime.build.echoes[1]?.set).toBe(999999)
    expect(hydratedProfile.runtime.local.setConditionals.off).toHaveProperty(String(invalidSetId))
    expect(hydratedProfile.runtime.rotation.personalItems).toEqual([invalidFeatureNode])
    expect(hydratedProfile.runtime.routing.selectedTargetsByOwnerKey).toEqual({ owner: invalidResonatorId })
    expect(hydrated.calculator.session.enemyProfile.id).not.toBe(invalidEnemyId)
    expect(activeRuntime?.build.team).toEqual([seed.id, null, null])
    expect(activeRuntime?.teamRuntimes).toEqual([null, null])
    expect(activeRuntime?.build.weapon.id).toBe(validWeaponId)
    expect(getWeaponById(activeRuntime!.build.weapon.id!)).toBeTruthy()
    expect(activeRuntime?.build.echoes[0]).toBeNull()
    expect(activeRuntime?.build.echoes[1]?.set).toBe(validEchoDefinition.sets[0])
    expect(workspace.actTgtSels).toEqual({})

    expect(hydrated.calculator.inventoryEchoes).toHaveLength(2)
    expect(hydrated.calculator.inventoryEchoes.map((entry) => entry.id)).toEqual([
      'stale-inventory-echo',
      'kept-inventory-echo',
    ])
    expect(hydrated.calculator.inventoryEchoes[0]?.echo.id).toBe('beta-only-echo')
    expect(hydrated.calculator.inventoryEchoes[1]?.echo.set).toBe(999999)
    expect(hydrated.calculator.inventoryBuilds).toHaveLength(2)
    expect(hydrated.calculator.inventoryBuilds[0]).toMatchObject({
      id: 'stale-build-owner',
      resonatorId: invalidResonatorId,
      resonatorName: 'Beta only',
    })
    expect(hydrated.calculator.inventoryBuilds[1]).toMatchObject({
      id: 'kept-build',
      resonatorId: seed.id,
      resonatorName: seed.name,
    })
    expect(hydrated.calculator.inventoryBuilds[1]?.build.weapon.id).toBe(invalidWeaponId)
    expect(hydrated.calculator.inventoryBuilds[1]?.build.echoes[0]?.id).toBe('beta-only-echo')
    expect(hydrated.calculator.inventoryBuilds[1]?.build.echoes[1]?.id).toBe(validEchoDefinition.id)

    expect(hydrated.calculator.inventoryRotations).toHaveLength(2)
    expect(hydrated.calculator.inventoryRotations[0]).toMatchObject({
      id: 'stale-rotation-owner',
      resonatorId: invalidResonatorId,
      resonatorName: 'Beta only',
      items: [invalidFeatureNode],
    })
    expect(hydrated.calculator.inventoryRotations[1]).toMatchObject({
      id: 'kept-rotation',
      resonatorId: seed.id,
      resonatorName: seed.name,
      team: [seed.id, invalidResonatorId, null],
      items: [invalidFeatureNode],
    })
    expect(hydrated.calculator.inventoryRotations[1]).toHaveProperty('snapshot')
    expect(hydrated.calculator.inventoryRotations[1]?.summary?.members).toEqual([
      {
        id: invalidResonatorId,
        name: 'Beta only',
        contribution: { normal: 1, avg: 1, crit: 1 },
      },
      {
        id: seed.id,
        name: seed.name,
        contribution: { normal: 2, avg: 2, crit: 2 },
      },
    ])

    expect(hydrated.calculator.optimizerContext?.resonatorId).toBe(invalidResonatorId)
    expect(hydrated.calculator.weaponSuggests.states).toHaveProperty(invalidWeaponId)
    if (validWeaponId) {
      expect(hydrated.calculator.weaponSuggests.states).toHaveProperty(validWeaponId)
    }
    expect(hydrated.calculator.suggestionsByResonatorId).toHaveProperty(invalidResonatorId)
    expect(hydrated.calculator.suggestionsByResonatorId[seed.id]).toMatchObject({
      settings: { targetFeatureId: 'beta-only-feature' },
      random: {
        setPreferences: [
          { setId: invalidSetId, count: 5 },
          { setId: validEchoDefinition.sets[0], count: 2 },
        ],
        mainEchoId: 'beta-only-echo',
      },
    })
    expectDerivedRuntimeRefsAreLive(hydrated)
  })

  it('migrates legacy resonator picker frequency into uncapped analytics storage', () => {
    const raw = structuredClone(makeAppState()) as unknown as {
      ui: {
        itemFreq: unknown
      }
    }

    raw.ui.itemFreq = {
      resonator: {
        ids: ['1506', '1507'],
        counts: {
          '1506': 3,
          '1507': 1,
          '1508': 5,
        },
      },
      echo: {
        ids: ['legacy-echo'],
        counts: {
          'legacy-echo': 2,
        },
      },
    }

    const parsed = persistedSchema.parse(raw)
    const resonator = parsed.ui.itemFreq.resonator

    expect(resonator.version).toBe(2)
    expect(resonator.order).toEqual(['1506', '1507', '1508'])
    expect(resonator.totalUses).toBe(9)
    expect(resonator.items['1506']).toMatchObject({
      id: '1506',
      count: 3,
      firstUsedAt: null,
      lastUsedAt: null,
      previousUsedAt: null,
      firstUseSeq: 1,
      lastUseSeq: 1,
      usesByDay: {},
    })
    expect(resonator.items['1508']?.count).toBe(5)

    // Only the rendered resonator bucket keeps old ids/counts. Other legacy
    // bucket data starts fresh under the analytics shape.
    expect(parsed.ui.itemFreq.echo).toMatchObject({
      version: 2,
      totalUses: 0,
      order: [],
      items: {},
    })
  })

  it('records picker frequency counts, timestamps, recency, sequence, and day buckets', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-22T10:20:30.000Z'))
      const first = applyPckrFre(normalizePckrFreqState(undefined), [{
        bucket: 'resonator',
        ids: ['1506', '1507', '1506', ''],
      }])

      vi.setSystemTime(new Date('2026-07-23T12:00:00.000Z'))
      const second = applyPckrFre(first, [{
        bucket: 'resonator',
        ids: ['1506', '1508'],
      }])

      const bucket = second.resonator
      expect(bucket.totalUses).toBe(4)
      expect(bucket.firstUsedAt).toBe('2026-07-22T10:20:30.000Z')
      expect(bucket.lastUsedAt).toBe('2026-07-23T12:00:00.000Z')
      expect(bucket.order).toEqual(['1506', '1508', '1507'])
      expect(bucket.items['1506']).toMatchObject({
        id: '1506',
        count: 2,
        firstUsedAt: '2026-07-22T10:20:30.000Z',
        lastUsedAt: '2026-07-23T12:00:00.000Z',
        previousUsedAt: '2026-07-22T10:20:30.000Z',
        firstUseSeq: 1,
        lastUseSeq: 3,
        usesByDay: {
          '2026-07-22': 1,
          '2026-07-23': 1,
        },
      })
      expect(bucket.items['1507']?.lastUseSeq).toBe(2)
      expect(bucket.items['1508']?.lastUseSeq).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('records active resonator context for non-active picker frequency items', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-22T10:20:30.000Z'))
      const first = applyPckrFre(normalizePckrFreqState(undefined), [
        {
          bucket: 'resonator',
          ids: ['1506'],
          activeResonatorId: '1506',
        },
        {
          bucket: 'teamResonator',
          slot: 'teammate1',
          ids: ['1507'],
          activeResonatorId: '1506',
        },
        {
          bucket: 'echo',
          ids: ['echo-a'],
          activeResonatorId: '1506',
        },
      ])

      vi.setSystemTime(new Date('2026-07-23T12:00:00.000Z'))
      const second = applyPckrFre(first, [{
        bucket: 'teamResonator',
        slot: 'teammate1',
        ids: ['1507'],
        activeResonatorId: '1508',
      }])

      expect(second.resonator.items['1506']).toMatchObject({
        firstActiveResonatorId: null,
        lastActiveResonatorId: null,
        previousActiveResonatorId: null,
        usesByActiveResonator: {},
      })
      expect(second.resonatorByTeamSlot.teammate1.items['1507']).toMatchObject({
        firstActiveResonatorId: '1506',
        lastActiveResonatorId: '1508',
        previousActiveResonatorId: '1506',
        usesByActiveResonator: {
          '1506': 1,
          '1508': 1,
        },
      })
      expect(second.echo.items['echo-a']).toMatchObject({
        firstActiveResonatorId: '1506',
        lastActiveResonatorId: '1506',
        previousActiveResonatorId: null,
        usesByActiveResonator: {
          '1506': 1,
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('round-trips current partial inventory and profile bundles into persisted snapshots', () => {
    const source = makeAppState()
    const recipient = makeAppState()
    const sourceStore = source as unknown as Parameters<typeof mkDataXprtFi>[0]
    const recipientStore = recipient as unknown as Parameters<typeof resMprtData>[1]
    const profileSeed = listResSds().find((seed) => seed.id !== DEF_RES_ID) ?? getFixtureSeed()

    source.calculator.profiles = {
      [profileSeed.id]: makeResProfile(profileSeed),
    }
    source.calculator.session.activeResonatorId = profileSeed.id

    const suggest = makeSuggest()
    suggest.random.bias = 73
    source.calculator.suggestionsByResonatorId = {
      [profileSeed.id]: suggest,
    }

    source.calculator.inventoryEchoes = [
      {
        id: 'inv-echo-1',
        echo: makeInventoryEchoInstance(listEchoes()[0].id),
        createdAt: 1,
        updatedAt: 2,
      },
    ]
    source.calculator.inventoryBuilds = [
      {
        id: 'saved-build-1',
        name: 'Saved Build',
        resonatorId: profileSeed.id,
        resonatorName: profileSeed.name,
        build: {
          weapon: { ...source.calculator.profiles[profileSeed.id].runtime.build.weapon },
          echoes: [makeInventoryEchoInstance(listEchoes()[0].id), null, null, null, null],
        },
        createdAt: 3,
        updatedAt: 4,
      },
    ]
    source.calculator.inventoryRotations = [
      {
        id: 'saved-rotation-1',
        name: 'Saved Rotation',
        mode: 'personal',
        resonatorId: profileSeed.id,
        resonatorName: profileSeed.name,
        duration: 12,
        note: 'rotation note',
        items: [],
        createdAt: 5,
        updatedAt: 6,
      },
    ]

    // partial exports should merge into the recipient snapshot without needing
    // the older all-data import path or resetting unrelated calculator domains
    const importedInventory = resMprtData(mkDataXprtFi(sourceStore, 'inventory').raw, recipientStore).snapshot
    expect(importedInventory.calculator.inventoryEchoes).toHaveLength(1)
    expect(importedInventory.calculator.inventoryBuilds).toHaveLength(1)
    expect(importedInventory.calculator.inventoryRotations).toHaveLength(1)
    expect(importedInventory.calculator.inventoryEchoes[0]?.echo.uid).toBe(
      source.calculator.inventoryEchoes[0]?.echo.uid,
    )

    const importedProfiles = resMprtData(mkDataXprtFi(sourceStore, 'profiles').raw, recipientStore).snapshot
    expect(Object.keys(importedProfiles.calculator.profiles)).toEqual([profileSeed.id])
    expect(importedProfiles.calculator.session.activeResonatorId).toBe(profileSeed.id)
    expect(importedProfiles.calculator.suggestionsByResonatorId[profileSeed.id]?.random.bias).toBe(73)
  })
})

describe('storage persistence routing', () => {
  beforeEach(() => {
    // consume initial writes so each case only observes the domain touched by
    // the action under test
    useAppStore.getState().resetState()
    consumePersist()

    const defaultSeed = resSdsById[DEF_RES_ID]
    if (!defaultSeed) {
      throw new Error(`missing default resonator ${DEF_RES_ID}`)
    }

    useAppStore.getState().actRes(defaultSeed)
    consumePersist()
  })

  it('marks only appearance persistence for theme changes', () => {
    useAppStore.getState().setTheme('dark')
    expect(consumePersist()).toEqual(['ui.appearance'])
  })

  it('marks only optimizer context when syncing optimizer state', () => {
    useAppStore.getState().ensureOptimizer()
    expect(consumePersist()).toEqual(['calculator.optimizerContext'])
  })

  it('marks session and layout domains for enemy updates', () => {
    const { enemyProfile } = useAppStore.getState().calculator.session
    useAppStore.getState().setEnemy({
      ...enemyProfile,
      level: enemyProfile.level + 1,
    })

    expect(consumePersist()).toEqual(['calculator.session', 'ui.layout'])
  })

  it('marks only echo inventory persistence when adding an echo', () => {
    useAppStore.getState().addInvEcho(makeInventoryEchoInstance(listEchoes()[0].id))
    expect(consumePersist()).toEqual(['calculator.inventory.echoes'])
  })

  it('blocks exact echo duplicates but freshens uid for same-slot sonata variants', () => {
    const multiSetEcho = listEchoes().find((echo) => echo.sets.length > 1)
    expect(multiSetEcho).toBeDefined()

    const first = makeInventoryEchoInstance(multiSetEcho!.id)
    const exactDuplicate: EchoInstance = {
      ...first,
      uid: makeEchoUid(),
      mainStats: {
        primary: { ...first.mainStats.primary },
        secondary: { ...first.mainStats.secondary },
      },
      substats: { ...first.substats },
    }
    const sonataVariant: EchoInstance = {
      ...first,
      set: multiSetEcho!.sets.find((setId) => setId !== first.set) ?? first.set,
      mainStats: {
        primary: { ...first.mainStats.primary },
        secondary: { ...first.mainStats.secondary },
      },
      substats: { ...first.substats },
    }

    const firstEntry = useAppStore.getState().addInvEcho(first)
    const duplicateEntry = useAppStore.getState().addInvEcho(exactDuplicate)
    const variantEntry = useAppStore.getState().addInvEcho(sonataVariant)

    expect(firstEntry?.echo.uid).toBe(first.uid)
    expect(duplicateEntry).toBeNull()
    expect(variantEntry?.echo.uid).not.toBe(first.uid)
    expect(variantEntry?.echo.set).toBe(sonataVariant.set)
    expect(useAppStore.getState().calculator.inventoryEchoes.map((entry) => entry.echo.uid))
      .toEqual([first.uid, variantEntry?.echo.uid])
  })
})
