/*
  Author: Runor Ewhro
  description: locks the import boundary between standalone context profiles
               and same-resonator teammate instances.
*/

import { describe, expect, it } from 'vitest'
import { makeResProfile, makeResRuntime, makeScenarioFromProfiles } from '@/engine/runtime/defaults.ts'
import { listResSds } from '@/data/catalog/resonatorSeedService.ts'
import { listEchoes } from '@/data/catalog/echoCatalogService.ts'
import { ECHO_SET_DEFS, getEchoSetCn } from '@/data/gameData/echoSets/effects.ts'
import { applyRuntimeToSimulation, materializeScenarioRuntime, runtimeFromSnapshot } from '@/engine/runtime/runtimeAdapters.ts'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import {
  mergeEchoImportIntoProfile,
  resolveEchoImportRuntime,
} from '@/modules/simulation/features/echoes/lib/echoImportDestination.ts'

describe('Echo import destinations', () => {
  const seed = listResSds()[0]
  const contextRuntime = makeResRuntime(seed)
  const teamRuntime = {
    ...makeResRuntime(seed),
    base: { ...makeResRuntime(seed).base, level: 77 },
  }
  const sonata = ECHO_SET_DEFS.find((definition) => definition.id === 22)!
  const sonataControl = getEchoSetCn(sonata.id, Object.keys(sonata.states)[0]!)
  const sonataEchoes: EchoInstance[] = listEchoes()
    .filter((echo) => echo.sets.includes(sonata.id))
    .slice(0, sonata.setMax)
    .map((echo, index) => ({
      uid: `import:${index}`,
      id: echo.id,
      set: sonata.id,
      mainEcho: index === 0,
      mainStats: {
        primary: { key: 'atkPercent', value: 0 },
        secondary: { key: 'atkFlat', value: 0 },
      },
      substats: {},
    }))

  it('keeps a context and teammate with the same resonator id distinct', () => {
    const contexts = { [seed.id]: contextRuntime }
    const team = { [seed.id]: teamRuntime }

    expect(resolveEchoImportRuntime(
      { kind: 'context', resonatorId: seed.id },
      contexts,
      team,
    )).toBe(contextRuntime)
    expect(resolveEchoImportRuntime(
      { kind: 'team', resonatorId: seed.id, slotIndex: 1 },
      contexts,
      team,
    )).toBe(teamRuntime)
  })

  it('writes imported build fields into a context profile without replacing its team', () => {
    const profile = makeResProfile(seed)
    const importedRuntime = {
      ...contextRuntime,
      base: { ...contextRuntime.base, level: 83, sequence: 4 },
      build: {
        ...contextRuntime.build,
        weapon: { ...contextRuntime.build.weapon, level: 70 },
      },
    }
    const next = mergeEchoImportIntoProfile(profile, importedRuntime)

    expect(next.runtime.progression.level).toBe(83)
    expect(next.runtime.progression.sequence).toBe(4)
    expect(next.runtime.build.weapon.level).toBe(70)
    expect(next.runtime.local.controls).toEqual(importedRuntime.state.controls)
    expect(next.runtime.team).toEqual(profile.runtime.team)
    expect(next.runtime.teamRuntimes).toEqual(profile.runtime.teamRuntimes)
  })

  it('persists newly available Sonata controls when a screenshot fills a fresh context', () => {
    const profile = makeResProfile(seed, { maxed: true })
    const runtime = runtimeFromSnapshot(profile)!
    const imported = {
      ...runtime,
      build: { ...runtime.build, echoes: sonataEchoes },
    }
    const next = mergeEchoImportIntoProfile(profile, imported)

    expect(sonataEchoes).toHaveLength(sonata.setMax)
    expect(next.runtime.local.controls[sonataControl]).toBe(true)
    expect(next.runtime.local.controls).toMatchObject(profile.runtime.local.controls)
  })

  it('persists newly available Sonata controls in an existing scenario', () => {
    const profile = makeResProfile(seed, { maxed: true })
    const scenario = makeScenarioFromProfiles({ [seed.id]: profile }, null, 0, seed.id)
    const previous = materializeScenarioRuntime(scenario, seed.id)!
    const imported = {
      ...previous,
      build: { ...previous.build, echoes: sonataEchoes },
    }
    const updated = applyRuntimeToSimulation(scenario, seed.id, imported, previous).scenario

    expect(updated.team.members[0].local.controls[sonataControl]).toBe(true)
    expect(updated.team.members[0].local.controls).toMatchObject(profile.runtime.local.controls)
  })
})
