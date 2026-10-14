/*
  Author: Runor Ewhro
  description: defines persisted inventory and saved-scenario mutations with
               semantic deduplication and stable item identity.
*/

import type { AppStore } from './store'
import { roverIdForGender } from '@/domain/entities/roverGender'
import { convertScenarioRoverGender } from './roverGenderConversion'
import type { StoreSliceContext } from './storeContracts'
import type { EchoInstance } from '@/domain/entities/runtime'
import { makeEchoUid } from '@/domain/entities/runtime'
import {
  equalEchoes, makeSavedEcho, getEchoSignature, dedupeEchoUids,
  equalBuildSnapshots, isEmptyBuild, makeSavedBuild, cloneEchoLoadout,
  makeSavedRotation, normalizeRotNote, normalizeDuration, makeSavedScenario,
} from '@/domain/entities/inventoryStorage'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { resSdsById } from '@/data/catalog/resonatorSeedService'
import { contextScenarioMember } from '@/domain/entities/combatScenario'
import { mkDefMkName, mkDefRotName } from './storeHelpers'

export type InventoryActionNames = 'addInvEcho' | 'addInvEchoes' | 'rplInvEcho' | 'updInvEcho' | 'cleanInvEcho' | 'rmInvEcho' | 'clrInvEcho' | 'addInvBuild' | 'updInvBuild' | 'rmInvBuild' | 'clrInvBuild' | 'addInvRot' | 'updInvRot' | 'rmInvRot' | 'clrInvRot' | 'saveScenario' | 'updSavedScenario' | 'rmSavedScenario' | 'clrSavedScenarios' | 'loadSavedScenario'

export function createInventoryActions({ get, persistedSet }: Pick<StoreSliceContext, 'get' | 'persistedSet'>): Pick<AppStore, InventoryActionNames> {
  return {
  addInvEcho: (echo) => {
    get().ensInvHydr()
    const invChs = get().library.echoes
    const existing = invChs.find((entry) =>
        equalEchoes(entry.echo, echo),
    )

    if (existing) {
      return null
    }

    // a uid identifies one physical echo, so a new entry takes a fresh uid when
    // the incoming echo's uid already belongs to another bag entry.
    const uidTaken = echo.uid != null
      && invChs.some((entry) => entry.echo.uid === echo.uid)
    const nextEntry = makeSavedEcho(uidTaken ? { ...echo, uid: makeEchoUid() } : echo)
    persistedSet(['library.echoes'], (state) => ({
      ...state,
      library: {
        ...state.library,
        echoes: [...state.library.echoes, nextEntry],
      },
    }), { historyLabel: 'Added Inventory Echo' })

    return nextEntry
  },

  addInvEchoes: (echoes) => {
    get().ensInvHydr()
    if (echoes.length === 0) {
      return []
    }

    const invChs = get().library.echoes
    // de-dupe by semantic echo signature before touching uids. a pasted/team
    // batch can contain old uids from equipped echoes; identical stat payloads
    // should be skipped, while distinct payloads with colliding uids get fresh
    // identity below.
    const knownEchoSigs = new Set(invChs.map((entry) => getEchoSignature(entry.echo)))
    const knownUids = new Set(invChs.map((entry) => entry.echo.uid).filter((uid): uid is string => Boolean(uid)))
    const echoesToAdd: EchoInstance[] = []

    for (const echo of echoes) {
      if (!getEchoById(echo.id)) {
        continue
      }

      const echoSig = getEchoSignature(echo)
      if (knownEchoSigs.has(echoSig)) {
        continue
      }

      let nextEcho = echo
      if (echo.uid != null && knownUids.has(echo.uid)) {
        // keep generating until the whole in-memory batch is collision-free,
        // not only collision-free against entries that were already saved.
        let nextUid = makeEchoUid()
        while (knownUids.has(nextUid)) {
          nextUid = makeEchoUid()
        }
        nextEcho = { ...echo, uid: nextUid }
      }

      knownEchoSigs.add(echoSig)
      if (nextEcho.uid) {
        knownUids.add(nextEcho.uid)
      }
      echoesToAdd.push(nextEcho)
    }

    if (echoesToAdd.length === 0) {
      return []
    }

    const now = Date.now()
    const nextEntries = echoesToAdd.map((echo, index) => makeSavedEcho(echo, now + index))

    persistedSet(['library.echoes'], (state) => ({
      ...state,
      library: {
        ...state.library,
        echoes: dedupeEchoUids([
          ...state.library.echoes,
          ...nextEntries,
        ]),
      },
    }), {
      historyLabel: nextEntries.length === 1 ? 'Added Inventory Echo' : 'Added Inventory Echoes',
    })

    return nextEntries
  },

  rplInvEcho: (echoes) => {
    get().ensInvHydr()
    const ddpdChs = echoes.reduce<EchoInstance[]>((acc, echo) => {
      if (acc.some((existing) => equalEchoes(existing, echo))) {
        return acc
      }

      acc.push({
        ...echo,
        uid: echo.uid,
        mainStats: {
          primary: { ...echo.mainStats.primary },
          secondary: { ...echo.mainStats.secondary },
        },
        substats: { ...echo.substats },
      })
      return acc
    }, [])

    const now = Date.now()

    persistedSet(['library.echoes'], (state) => ({
      ...state,
      library: {
        ...state.library,
        echoes: dedupeEchoUids(
          ddpdChs.map((echo, index) => makeSavedEcho(echo, now + index)),
        ),
      },
    }), { historyLabel: 'Replaced Inventory Echoes' })
  },

  updInvEcho: (entryId, echo) => {
    get().ensInvHydr()
    persistedSet(['library.echoes'], (state) => ({
      ...state,
      library: {
        ...state.library,
        echoes: state.library.echoes.map((entry) =>
            entry.id === entryId
                ? {
                  ...entry,
                  echo: {
                    ...echo,
                    uid: echo.uid,
                    mainStats: {
                      primary: { ...echo.mainStats.primary },
                      secondary: { ...echo.mainStats.secondary },
                    },
                    substats: { ...echo.substats },
                  },
                  updatedAt: Date.now(),
                }
                : entry,
        ),
      },
    }), { historyLabel: 'Updated Inventory Echo' })
  },

  cleanInvEcho: () => {
    get().ensInvHydr()
    const invChs = get().library.echoes
    const vldInvChs = invChs.filter((entry) => getEchoById(entry.echo.id))
    const removedCount = invChs.length - vldInvChs.length

    if (removedCount === 0) {
      return 0
    }

    persistedSet(['library.echoes'], (state) => ({
      ...state,
      library: {
        ...state.library,
        echoes: state.library.echoes.filter((entry) => getEchoById(entry.echo.id)),
      },
    }), { historyLabel: 'Cleaned Inventory Echoes', recHist: false })

    return removedCount
  },

  rmInvEcho: (entryId) => {
    get().ensInvHydr()
    persistedSet(['library.echoes'], (state) => ({
      ...state,
      library: {
        ...state.library,
        echoes: state.library.echoes.filter((entry) => entry.id !== entryId),
      },
    }), { historyLabel: 'Removed Inventory Echo' })
  },

  clrInvEcho: () => {
    get().ensInvHydr()
    persistedSet(['library.echoes'], (state) => ({
      ...state,
      library: {
        ...state.library,
        echoes: [],
      },
    }), { historyLabel: 'Cleared Inventory Echoes' })
  },

  addInvBuild: ({ name, resonatorId, resonatorName: resName, build }) => {
    get().ensInvHydr()
    resonatorId = roverIdForGender(resonatorId, get().ui.preferences.roverGender)
    if (isEmptyBuild(build)) {
      return null
    }

    const existing = get().library.builds.find((entry) =>
        equalBuildSnapshots(entry.build, build),
    )

    if (existing) {
      return null
    }

    const builds = get().library.builds
    const nextEntry = makeSavedBuild({
      name: name?.trim() || mkDefMkName(resName, builds.length),
      resonatorId,
      resonatorName: resName,
      build,
    })

    persistedSet(['library.builds'], (state) => ({
      ...state,
      library: {
        ...state.library,
        builds: [...state.library.builds, nextEntry],
      },
    }), { historyLabel: 'Added Inventory Build' })

    return nextEntry
  },

  updInvBuild: (entryId, changes) => {
    get().ensInvHydr()
    persistedSet(['library.builds'], (state) => ({
      ...state,
      library: {
        ...state.library,
        builds: state.library.builds.map((entry) => {
          if (entry.id !== entryId) {
            return entry
          }

          return {
            ...entry,
            ...(changes.name != null ? { name: changes.name.trim() || entry.name } : {}),
            ...(changes.build
                ? {
                  build: {
                    weapon: { ...changes.build.weapon },
                    echoes: cloneEchoLoadout(changes.build.echoes),
                  },
                }
                : {}),
            updatedAt: Date.now(),
          }
        }),
      },
    }), { historyLabel: 'Updated Inventory Build' })
  },

  rmInvBuild: (entryId) => {
    get().ensInvHydr()
    persistedSet(['library.builds'], (state) => ({
      ...state,
      library: {
        ...state.library,
        builds: state.library.builds.filter((entry) => entry.id !== entryId),
      },
    }), { historyLabel: 'Removed Inventory Build' })
  },

  clrInvBuild: () => {
    get().ensInvHydr()
    persistedSet(['library.builds'], (state) => ({
      ...state,
      library: {
        ...state.library,
        builds: [],
      },
    }), { historyLabel: 'Cleared Inventory Builds' })
  },

  addInvRot: ({ name, duration, note, scenario }) => {
    get().ensureSavedRotations()
    scenario = convertScenarioRoverGender(scenario, get().ui.preferences.roverGender)
    const rotations = get().library.rotations
    const contextMember = contextScenarioMember(scenario)
    const contextName = resSdsById[contextMember.resonatorId]?.name ?? contextMember.resonatorId
    const nextEntry = makeSavedRotation({
      name: name?.trim() || mkDefRotName(
          contextName,
          rotations.length,
      ),
      duration,
      note,
      scenario,
    })

    persistedSet(['library.rotations'], (state) => ({
      ...state,
      library: {
        ...state.library,
        rotations: [...state.library.rotations, nextEntry],
      },
    }), { historyLabel: 'Added Inventory Rotation' })

    return nextEntry
  },

  updInvRot: (entryId, changes) => {
    get().ensureSavedRotations()
    persistedSet(['library.rotations'], (state) => ({
      ...state,
      library: {
        ...state.library,
        rotations: state.library.rotations.map((entry) => {
          if (entry.id !== entryId) {
            return entry
          }

          return {
            ...entry,
            ...(changes.name != null ? { name: changes.name.trim() || entry.name } : {}),
            ...(changes.note !== undefined ? { note: normalizeRotNote(changes.note) } : {}),
            ...(changes.duration !== undefined ? { duration: normalizeDuration(changes.duration) } : {}),
            updatedAt: Date.now(),
          }
        }),
      },
    }), { historyLabel: 'Updated Inventory Rotation' })
  },

  rmInvRot: (entryId) => {
    get().ensureSavedRotations()
    persistedSet(['library.rotations'], (state) => ({
      ...state,
      library: {
        ...state.library,
        rotations: state.library.rotations.filter((entry) => entry.id !== entryId),
      },
    }), { historyLabel: 'Removed Inventory Rotation' })
  },

  clrInvRot: () => {
    get().ensureSavedRotations()
    persistedSet(['library.rotations'], (state) => ({
      ...state,
      library: {
        ...state.library,
        rotations: [],
      },
    }), { historyLabel: 'Cleared Inventory Rotations' })
  },

  saveScenario: (input = {}) => {
    get().ensureSavedRotations()
    const state = get()
    const scenarioId = input.scenarioId ?? state.combat.selectedScenarioId
    const scenario = state.combat.scenariosById[scenarioId]
    if (!scenario) return null

    const contextMember = contextScenarioMember(scenario)
    const contextName = resSdsById[contextMember.resonatorId]?.name ?? contextMember.resonatorId
    const nextEntry = makeSavedScenario({
      name: input.name?.trim() || `${contextName} Scenario ${state.library.scenarios.length + 1}`,
      note: input.note,
      scenario,
    })

    persistedSet(['library.scenarios'], (current) => ({
      ...current,
      library: {
        ...current.library,
        scenarios: [...current.library.scenarios, nextEntry],
      },
    }), { historyLabel: 'Saved Scenario' })
    return nextEntry
  },

  updSavedScenario: (entryId, changes) => {
    get().ensureSavedRotations()
    persistedSet(['library.scenarios'], (state) => ({
      ...state,
      library: {
        ...state.library,
        scenarios: state.library.scenarios.map((entry) => entry.id === entryId
          ? {
            ...entry,
            ...(changes.name != null ? { name: changes.name.trim() || entry.name } : {}),
            ...(changes.note !== undefined ? { note: normalizeRotNote(changes.note) } : {}),
            updatedAt: Date.now(),
          }
          : entry),
      },
    }), { historyLabel: 'Updated Saved Scenario' })
  },

  rmSavedScenario: (entryId) => {
    get().ensureSavedRotations()
    persistedSet(['library.scenarios'], (state) => ({
      ...state,
      library: {
        ...state.library,
        scenarios: state.library.scenarios.filter((entry) => entry.id !== entryId),
      },
    }), { historyLabel: 'Removed Saved Scenario' })
  },

  clrSavedScenarios: () => {
    get().ensureSavedRotations()
    persistedSet(['library.scenarios'], (state) => ({
      ...state,
      library: {
        ...state.library,
        scenarios: [],
      },
    }), { historyLabel: 'Cleared Saved Scenarios' })
  },

  loadSavedScenario: (entryId) => {
    get().ensureSavedRotations()
    const entry = get().library.scenarios.find((candidate) => candidate.id === entryId)
    return entry ? get().applyScenarioSnapshot(entry.scenario) : null
  },

  }
}
