/*
  Author: Runor Ewhro
  description: verifies that set-plan rows stand in worn sets among
               effect-equivalent alternatives, keep the engine's pick on ties,
               and leave filler slots as worn.
*/

import { describe, expect, it } from 'vitest'
import { preferWornSets } from '../model.ts'

describe('worn-preferring set plans', () => {
  it('keeps the worn set in an equivalent slot and leads the slot with it', () => {
    const display = [{ setIds: [5, 11, 24, 26], pieces: 2 }, { setIds: [5, 11, 24, 26], pieces: 2 }]
    const concrete = [{ setId: 24, pieces: 2 }, { setId: 26, pieces: 2 }]
    const { setPlan, display: led } = preferWornSets(display, concrete, [{ setId: 11, pieces: 5 }])
    expect(setPlan.map((entry) => entry.setId)).toContain(11)
    expect(new Set(setPlan.map((entry) => entry.setId)).size).toBe(2)
    expect(led.map((entry) => entry.setIds[0]).sort()).toEqual(setPlan.map((entry) => entry.setId).sort())
    expect(led.every((entry, index) => entry.setIds.length === display[index].setIds.length)).toBe(true)
  })

  it('keeps the engine pick when nothing worn fits a slot', () => {
    const display = [{ setIds: [34], pieces: 3 }, { setIds: [1, 35, 36], pieces: 2 }]
    const concrete = [{ setId: 34, pieces: 3 }, { setId: 36, pieces: 2 }]
    expect(preferWornSets(display, concrete, [{ setId: 9, pieces: 5 }]).setPlan).toEqual(concrete)
  })

  it('keeps worn Echoes when the display omits filler entries', () => {
    const display = [{ setIds: [5, 11], pieces: 2 }, { setIds: [24, 26], pieces: 2 }]
    const concrete = [{ setId: 5, pieces: 2 }, { setId: 24, pieces: 2 }, { setId: 12, pieces: 1 }]
    const { setPlan } = preferWornSets(display, concrete, [{ setId: 11, pieces: 5 }])
    expect(setPlan).toEqual([{ setId: 11, pieces: 2 }, { setId: 24, pieces: 2 }])
  })

  it('keeps fillers when dropping them would let worn echoes rebuild a tier', () => {
    // a lone 2pc slot: three free worn eternal radiance echoes would restore 5pc.
    const display = [{ setIds: [5, 11], pieces: 2 }]
    const concrete = [{ setId: 5, pieces: 2 }, { setId: 12, pieces: 1 }, { setId: 13, pieces: 1 }, { setId: 14, pieces: 1 }]
    const { setPlan } = preferWornSets(display, concrete, [{ setId: 11, pieces: 5 }])
    expect(setPlan).toEqual([{ setId: 11, pieces: 2 }, ...concrete.slice(1)])
  })

  it('keeps the engine plan when the swap alone could reach a tier it never scored', () => {
    const display = [{ setIds: [5, 11], pieces: 2 }]
    const concrete = [{ setId: 5, pieces: 2 }]
    expect(preferWornSets(display, concrete, [{ setId: 11, pieces: 5 }]).setPlan).toEqual(concrete)
  })
})
