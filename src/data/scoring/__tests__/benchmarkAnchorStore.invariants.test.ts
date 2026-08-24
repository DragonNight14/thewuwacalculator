/*
  Author: Runor Ewhro
  Description: Locks persisted benchmark anchors to the current scoring revision.
*/

import { describe, expect, it } from 'vitest'
import type { BenchmarkAnchors } from '@/data/scoring/benchmark/search.ts'
import {
  BENCHMARK_ANCHOR_CACHE_REVISION,
  selectCurrentAnchorEntries,
  type StoredAnchor,
} from '@/data/scoring/benchmark/anchorStore.ts'

describe('benchmark anchor persistence', () => {
  it('rejects legacy scoring revisions before hydrating the fast-path cache', () => {
    const legacy = { marker: 'legacy' } as unknown as BenchmarkAnchors
    const current = { marker: 'current' } as unknown as BenchmarkAnchors
    const rows: StoredAnchor[] = [
      { key: 'legacy-unversioned', anchors: legacy, ts: 1 },
      {
        key: 'legacy-versioned',
        anchors: legacy,
        ts: 2,
        revision: BENCHMARK_ANCHOR_CACHE_REVISION - 1,
      },
      {
        key: 'current',
        anchors: current,
        ts: 3,
        revision: BENCHMARK_ANCHOR_CACHE_REVISION,
      },
    ]

    expect(selectCurrentAnchorEntries(rows)).toEqual([['current', current]])
  })
})
