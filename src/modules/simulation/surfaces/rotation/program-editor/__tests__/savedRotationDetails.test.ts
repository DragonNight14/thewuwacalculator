/*
  Author: Runor Ewhro
  description: guards saved detail scheduling against live and unavailable ids.
*/

import { describe, expect, it, vi } from 'vitest'
import { makeResProfile, makeScenarioFromProfiles } from '@/engine/runtime/defaults.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { makeLiveRotationEntry } from '@/engine/runtime/liveRotationEntry.ts'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import type { RunResult } from '../simulation/runProgram.ts'
import { pendingSavedRotationDetails, runSavedRotationDetailBatch } from '../simulation/simulation.ts'

function fixture() {
  const seed = getResSeedBy('1108')!
  const scenario = makeScenarioFromProfiles({ [seed.id]: makeResProfile(seed) }, null, 0, seed.id)
  const live = makeLiveRotationEntry(scenario, seed.name, { lastRanAt: 1 })!
  const saved: SavedRotation = { ...live, id: 'saved-rotation' }
  return { live, saved }
}

describe('saved rotation detail scheduling', () => {
  it('keeps rich detail and its flat trace on the main thread', async () => {
    const { saved } = fixture()
    const worker = vi.fn(() => { throw new Error('detail must not enter a worker') })
    vi.stubGlobal('Worker', worker)
    try {
      const result = await runSavedRotationDetailBatch([saved])
      expect(result.has(saved.id)).toBe(true)
      expect(worker).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not schedule an empty batch for a live comparison', () => {
    const { live, saved } = fixture()
    const completed = new Map<string, RunResult | null>([[saved.id, null]])

    expect(pendingSavedRotationDetails([saved], [live.id], completed)).toEqual([])
    expect(pendingSavedRotationDetails([saved], [saved.id, live.id], completed)).toEqual([])
  })

  it('loads saved details once when comparing against the live run', () => {
    const { live, saved } = fixture()
    const requested = [live.id, saved.id]
    const completed = new Map<string, RunResult | null>()

    expect(pendingSavedRotationDetails([saved], requested, completed)).toEqual([saved])
    // an unavailable simulation counts as a completed lookup and is not retried.
    completed.set(saved.id, null)
    expect(pendingSavedRotationDetails([saved], requested, completed)).toEqual([])
  })

  it('ignores removed entries and resumes when an entry becomes available', () => {
    const { saved } = fixture()
    const completed = new Map<string, RunResult | null>()

    expect(pendingSavedRotationDetails([], [saved.id], completed)).toEqual([])
    expect(pendingSavedRotationDetails([saved], [saved.id], completed)).toEqual([saved])
    expect(pendingSavedRotationDetails([saved], [], completed)).toEqual([])
  })
})
