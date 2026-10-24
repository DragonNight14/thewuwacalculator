/*
  Author: Runor Ewhro
  description: checks result predicates against displayed values and stat usage.
*/

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIEW_CRITERIA,
  facetMatches,
  viewNeedsStats,
  type ResultFacet,
} from '@/modules/simulation/surfaces/optimizer/lib/results.ts'

function facet(stats: ResultFacet['stats'], damage = 1000.9): ResultFacet {
  return { damage, mainId: '', totalCost: 12, setBadges: [], planKey: '', stats }
}

const sheet = { atk: 3022.9999991, hp: 15585, def: 1378.66, er: 122.7999997138977, cr: 75.54, cd: 299, bonus: 40, amp: 25 }

describe('result predicates', () => {
  it('matches displayed values after precision handling', () => {
    expect(facetMatches(facet(sheet), [{ kind: 'num', col: 'er', op: 'eq', value: 122.8 }])).toBe(true)
    expect(facetMatches(facet(sheet), [{ kind: 'num', col: 'atk', op: 'eq', value: 3023 }])).toBe(true)
  })

  it('compares percentage stats at one decimal place', () => {
    expect(facetMatches(facet(sheet), [{ kind: 'num', col: 'cr', op: 'lte', value: 75.5 }])).toBe(true)
    expect(facetMatches(facet(sheet), [{ kind: 'num', col: 'cr', op: 'gt', value: 75.5 }])).toBe(false)
  })

  it('compares whole-number damage', () => {
    expect(facetMatches(facet(sheet), [{ kind: 'num', col: 'damage', op: 'eq', value: 1000 }])).toBe(true)
  })

  it('requests stats for stat-based sort, filter, or find predicates', () => {
    expect(viewNeedsStats(DEFAULT_VIEW_CRITERIA, [])).toBe(false)
    expect(viewNeedsStats({ ...DEFAULT_VIEW_CRITERIA, filter: [{ kind: 'cat', col: 'set', value: '1' }] }, [])).toBe(false)
    expect(viewNeedsStats(DEFAULT_VIEW_CRITERIA, [{ kind: 'num', col: 'cost', op: 'eq', value: 12 }])).toBe(false)
    expect(viewNeedsStats({ ...DEFAULT_VIEW_CRITERIA, sortKey: 'cr' }, [])).toBe(true)
    expect(viewNeedsStats(DEFAULT_VIEW_CRITERIA, [{ kind: 'num', col: 'bonus', op: 'gte', value: 30 }])).toBe(true)
  })
})
