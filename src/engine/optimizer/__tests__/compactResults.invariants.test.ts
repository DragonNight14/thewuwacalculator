/*
  Author: Runor Ewhro
  description: verifies compact optimizer result reconstruction, shared immutable
               candidate data, identity rejection, and exact facet projection.
*/

import { expect, it } from 'vitest'
import { listChsByCos } from '@/data/catalog/echoCatalogService'
import { compactTheoryEchoes, matThryRsltCh, theoryResultCompactor } from '../results/theoryEchoes'
import type { CompactTheoryResult, OptBagResult, PrepTheoryTarget } from '../types'

function fixture(): PrepTheoryTarget {
  const cats = [...listChsByCos(4).slice(0, 1), ...listChsByCos(3).slice(0, 2), ...listChsByCos(1).slice(0, 2)]
  return {
    profs: cats.map((_, slot) => ({ uid: `profile-${slot}`, substats: { critRate: 6.3, atkPercent: 8.6 } })),
    cats,
    theoryRows: cats.map((cat, slot) => ({ slot, id: slot === 0 ? cat.id : null, ids: [cat.id], set: cat.sets[0], cost: cat.cost, main: 'atkPercent', mainOk: slot === 0 })),
  } as unknown as PrepTheoryTarget
}
const bag: OptBagResult = { i0: 0, i1: 1, i2: 2, i3: 3, i4: 4, damage: 123.456 }

it('reconstructs the original theory loadout, shares candidates, and detaches edits', () => {
  const payload = fixture()
  const compact = theoryResultCompactor(payload)
  const first: CompactTheoryResult = { ...compact(bag)!, stats: null, weaponId: 'test-weapon' }
  const second: CompactTheoryResult = { ...compact({ ...bag, damage: 99 })!, stats: null }
  expect(first.theory).toBe(second.theory)
  expect(first.theory.candidates).toHaveLength(5)
  expect(compactTheoryEchoes(first)).toEqual(matThryRsltCh(payload, bag))
  const transferred = structuredClone([first, second])
  expect(transferred[0].theory).toBe(transferred[1].theory)
  expect(transferred[0].weaponId).toBe('test-weapon')
  const preview = compactTheoryEchoes(transferred[0])
  preview[0].substats.critRate = 999
  preview[0].mainStats.primary.value = 999
  expect(compactTheoryEchoes(transferred[1])).toEqual(matThryRsltCh(payload, bag))
  expect(Object.keys(first)).not.toContain('echoes')
})

it('rejects missing rows and duplicate physical Echo identities', () => {
  const payload = fixture()
  const compact = theoryResultCompactor(payload)
  expect(compact({ ...bag, i4: 99999 })).toBeNull()
  payload.theoryRows[4].id = payload.theoryRows[0].id
  expect(compact(bag)).toBeNull()
})

it('retains exact numeric facet values, null stats, stable ties, and shared set plans', async () => {
  const { ResultFacetTable, buildResultView, facetPlans, facetMainEchoes } = await import('@/modules/simulation/surfaces/optimizer/lib/results')
  const stats = { atk: 123.456789, hp: 1, def: 2, er: 3, cr: 4, cd: 5, bonus: 6, amp: 7 }
  const rows = [
    { damage: 10.123456789, mainId: '11', totalCost: 12, setBadges: [{ id: 1, count: 5 }], planKey: '1:5', stats },
    { damage: 10.123456789, mainId: '12', totalCost: 10, setBadges: [{ id: 1, count: 5 }], planKey: '1:5', stats: null },
  ]
  const table = new ResultFacetTable(rows.length)
  rows.forEach((row, index) => table.set(index, row))
  expect([...table]).toEqual(rows)
  expect(table.get(0).setBadges).toBe(table.get(1).setBadges)
  expect(buildResultView(table, { sortKey: 'damage', sortDir: 'desc', filter: [] })).toEqual([0, 1])
  expect(buildResultView(table, { sortKey: 'atk', sortDir: 'asc', filter: [{ kind: 'num', col: 'atk', op: 'gt', value: 120 }] })).toEqual([0])
  expect(facetPlans(table)).toEqual(facetPlans(rows))
  expect(facetMainEchoes(table)).toEqual(facetMainEchoes(rows))
})
