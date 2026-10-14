/*
  Author: Runor Ewhro
  description: keeps full max and import effects-only max aligned across
               progression, weapon, resonator, echo, and sonata state.
*/

import { describe, expect, it } from 'vitest'
import { listEchoes } from '@/data/catalog/echoCatalogService'
import { getResSeedBy, listResSds } from '@/data/catalog/resonatorSeedService'
import { ECHO_SET_DEFS, getEchoSetCn } from '@/data/gameData/echoSets/effects'
import type { EchoInstance } from '@/domain/entities/runtime'
import { makeResRuntime } from '@/engine/runtime/defaults'
import { isRuntimeMaxed, maxRuntime, maxRuntimeEffects } from '@/engine/runtime/maxRuntime'

const resonator = getResSeedBy('1210')!
const sonata = ECHO_SET_DEFS.find((definition) => definition.id === 22)!
const sonataControl = getEchoSetCn(sonata.id, Object.keys(sonata.states)[0]!)
const echoes: EchoInstance[] = listEchoes()
  .filter((echo) => echo.sets.includes(sonata.id))
  .slice(0, sonata.setMax)
  .map((echo, index) => ({
    uid: `max:${index}`,
    id: echo.id,
    set: sonata.id,
    mainEcho: index === 0,
    mainStats: {
      primary: { key: 'atkPercent', value: 0 },
      secondary: { key: 'atkFlat', value: 0 },
    },
    substats: {},
  }))

function equippedRuntime() {
  const base = makeResRuntime(resonator)
  return {
    ...base,
    base: { ...base.base, level: 80, sequence: 6 },
    build: {
      ...base.build,
      weapon: { ...base.build.weapon, level: 70, rank: 4 },
      echoes,
    },
  }
}

describe('resonator runtime Max', () => {
  it('reaches a stable full Max state for every catalog resonator', () => {
    const unstable = listResSds().filter((seed) => {
      const runtime = makeResRuntime(seed)
      const first = maxRuntime({
        ...runtime,
        build: { ...runtime.build, echoes },
      })
      return !isRuntimeMaxed(first, maxRuntime(first))
    })

    expect(unstable.map((seed) => seed.id)).toEqual([])
  })

  it('maxes progression, weapon, and equipped effect controls without replacing gear', () => {
    const before = equippedRuntime()
    const after = maxRuntime(before)

    expect(echoes).toHaveLength(sonata.setMax)
    expect(isRuntimeMaxed(before, after)).toBe(false)
    expect(after.base.level).toBe(90)
    expect(after.base.sequence).toBe(6)
    expect(after.base.skillLevels.resonanceSkill).toBe(10)
    expect(after.build.weapon.level).toBe(90)
    expect(after.build.weapon.rank).toBe(4)
    expect(after.build.echoes).toBe(echoes)
    expect(after.state.controls['resonator:1210:fusion_trail:value']).toBe(60)
    expect(after.state.controls[sonataControl]).toBe(true)
    expect(isRuntimeMaxed(after, maxRuntime(after))).toBe(true)
  })

  it('maxes an equipped main Echo effect when its paired Echo is present', () => {
    const base = makeResRuntime(resonator)
    const [main, paired] = ['6000179', '6000180'].map((id, index) => {
      const definition = listEchoes().find((echo) => echo.id === id)!
      return {
        ...echoes[0],
        uid: `paired:${index}`,
        id,
        set: definition.sets[0],
        mainEcho: index === 0,
      }
    })
    const runtime = {
      ...base,
      build: { ...base.build, echoes: [main, paired, null, null, null] },
    }

    const maxed = maxRuntime(runtime)
    expect(maxed.state.controls['echo:6000179:main:stacks']).toBe(6)
    expect(maxed.build.echoes).toBe(runtime.build.echoes)
  })

  it('maxes effects after import while preserving card progression and weapon level', () => {
    const before = equippedRuntime()
    const after = maxRuntimeEffects(before)

    expect(after.base).toEqual(before.base)
    expect(after.build.weapon).toEqual(before.build.weapon)
    expect(after.build.echoes).toBe(echoes)
    expect(after.state.controls['resonator:1210:fusion_trail:value']).toBe(60)
    expect(after.state.controls[sonataControl]).toBe(true)
  })
})
