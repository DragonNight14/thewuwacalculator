/*
  Author: Runor Ewhro
  description: verifies result collection remains correct while its per-set
               lookup table grows and the top-result heap is retained.
*/

import { describe, expect, it } from 'vitest'
import { OptResultSet } from '@/engine/optimizer/results/collector.ts'

describe('optimizer result collector', () => {
  it('keeps the set pushed while its best-per-set table grows', () => {
    // rising damage keeps every push in the heap, and 400 distinct sets cross
    // the lookup table's first growth (at 384 entries for k = 128) inside the
    // final top-k
    const collector = new OptResultSet(128)
    const keys: string[] = []
    for (let index = 0; index < 400; index += 1) {
      const ids = [index, index + 1000, index + 2000, index + 3000, index + 4000]
      collector.push5(index + 1, ids[0]!, ids[1]!, ids[2]!, ids[3]!, ids[4]!)
      keys.push(ids.join(','))
    }

    const expected = keys.slice(-128).reverse()
    const actual = collector.sorted().map((entry) => [entry.i0, entry.i1, entry.i2, entry.i3, entry.i4].join(','))
    expect(actual).toEqual(expected)
  })
})
