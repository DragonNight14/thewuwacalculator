/*
  Author: Runor Ewhro
  description: keeps the two snowfall consumption outcomes mutually exclusive
               in source controls and effect evaluation.
*/

import { describe, expect, it } from 'vitest'
import { listEffectsFor, listStatesFor } from '@/data/catalog/gameDataService.ts'
import type { EffectScope } from '@/domain/gameData/contracts.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { evalCond } from '@/engine/effects/evaluator.ts'
import { setSourceState } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'

const prefix = 'echoSet:30:bonus:'

function activeEffects(crit: boolean, outro: boolean): string[] {
  const sourceRuntime = {
    state: {
      controls: {
        [`${prefix}snowfall`]: true,
        [`${prefix}snowfallCrit`]: crit,
        [`${prefix}snowfallOutro`]: outro,
      },
    },
  } as unknown as EffectScope['sourceRuntime']
  const scope = {
    sourceRuntime,
    targetRuntime: sourceRuntime,
    activeRuntime: sourceRuntime,
    context: { echoSetCounts: { 30: 5 } },
  } as unknown as EffectScope

  return listEffectsFor('echoSet', '30')
    .filter((effect) => evalCond(effect.condition, scope))
    .map((effect) => effect.id)
}

describe('Wishes of Quiet Snowfall', () => {
  it('resets the other Snowfall outcome when either one is enabled', () => {
    const states = listStatesFor('echoSet', '30')
    expect(states.find((state) => state.id === 'snowfallCrit')?.resets)
      .toEqual([`${prefix}snowfallOutro`])
    expect(states.find((state) => state.id === 'snowfallOutro')?.resets)
      .toEqual([`${prefix}snowfallCrit`])
  })

  it('switches the live control to the selected outcome', () => {
    const states = listStatesFor('echoSet', '30')
    const crit = states.find((state) => state.id === 'snowfallCrit')!
    const outro = states.find((state) => state.id === 'snowfallOutro')!
    let runtime = {
      id: '1109',
      state: { controls: { [`${prefix}snowfallCrit`]: true, [`${prefix}snowfallOutro`]: false } },
    } as unknown as ResRuntime
    const update = (updater: (current: ResRuntime) => ResRuntime) => { runtime = updater(runtime) }

    setSourceState(update, runtime, runtime, outro, true)
    expect(runtime.state.controls[`${prefix}snowfallCrit`]).toBe(false)
    expect(runtime.state.controls[`${prefix}snowfallOutro`]).toBe(true)

    setSourceState(update, runtime, runtime, crit, true)
    expect(runtime.state.controls[`${prefix}snowfallCrit`]).toBe(true)
    expect(runtime.state.controls[`${prefix}snowfallOutro`]).toBe(false)
  })

  it('never applies both outcomes, even for an older loadout with both toggles enabled', () => {
    expect(activeEffects(true, false)).toContain('echoSet:30:snowfallCrit')
    expect(activeEffects(false, true)).toContain('echoSet:30:snowfallOutro')

    const both = activeEffects(true, true)
    expect(both).toContain('echoSet:30:snowfall')
    expect(both).toContain('echoSet:30:snowfallOutro')
    expect(both).not.toContain('echoSet:30:snowfallCrit')
  })
})
