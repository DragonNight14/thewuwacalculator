/*
  Author: Runor Ewhro
  description: verifies loop meta logic and compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import { makeLoopInfo } from '@/modules/simulation/surfaces/rotation/shared/loopMeta.ts'
import type { FeatureResult, RotationNode } from '@/domain/gameData/contracts.ts'

describe('loop totals', () => {
  it('uses only damage outputs for loop totals', () => {
    const entry = (aggregationType: FeatureResult['aggregationType'], avg: number) => ({
      id: `${aggregationType}-${avg}`,
      resonatorId: 'test',
      resonatorName: 'Test',
      aggregationType,
      normal: avg,
      crit: avg,
      avg,
      loopRuns: { loop: 1 },
    }) as unknown as FeatureResult
    const items = [
      { id: 'start', type: 'loop', kind: 'start', loopId: 'loop', runs: 1 },
      { id: 'end', type: 'loop', kind: 'end', loopId: 'loop' },
    ] as RotationNode[]

    expect(makeLoopInfo(items, [entry('damage', 100), entry('healing', 50)]).loops[0]?.totals)
      .toEqual({ normal: 100, crit: 100, avg: 100 })
  })
})
