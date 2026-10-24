/*
  Author: Runor Ewhro
  description: verifies set-plan grouping removes only genuinely redundant
               scored plans while retaining distinct main and team effects.
*/

import { describe, expect, it } from 'vitest'
import { collapseScoredDamageTies, groupEquivalentSetPlans } from '@/engine/suggestions/setPlan/suggest'
import type { SetPlanSuggest, SuggestContext } from '@/engine/suggestions/types'

describe('set plan display equivalence', () => {
  it.each([
    { name: 'a mixed plan with no benefit over no bonuses', subset: [], full: [{ setId: 23, pieces: 3 }, { setId: 1, pieces: 2 }] },
    { name: 'an extra 2pc bonus with no benefit over 3pc', subset: [{ setId: 23, pieces: 3 }], full: [{ setId: 23, pieces: 3 }, { setId: 1, pieces: 2 }] },
    { name: 'an extra 1pc bonus with no benefit over 3pc', subset: [{ setId: 23, pieces: 3 }], full: [{ setId: 23, pieces: 3 }, { setId: 32, pieces: 1 }] },
    { name: 'pieces beyond the useful 3pc threshold', subset: [{ setId: 23, pieces: 3 }], full: [{ setId: 23, pieces: 4 }] },
    { name: 'a 5pc upgrade with no benefit over its own 2pc', subset: [{ setId: 1, pieces: 2 }], full: [{ setId: 1, pieces: 5 }] },
  ])('filters $name', ({ subset, full }) => {
    const useful: SetPlanSuggest = { setPlan: subset, avgDamage: 100, echoes: [] }
    const redundant: SetPlanSuggest = { setPlan: full, avgDamage: 100, echoes: [] }
    expect(collapseScoredDamageTies([redundant, useful])).toEqual([useful])
  })

it('keeps bonuses when removing them changes the main Echo', () => {
    const single: SetPlanSuggest = {
      setPlan: [{ setId: 1, pieces: 2 }], avgDamage: 100, echoes: [], mainEchoId: '6000052', mainEchoSetId: 8,
    }
    const mixed: SetPlanSuggest = {
      setPlan: [{ setId: 1, pieces: 2 }, { setId: 23, pieces: 3 }], avgDamage: 100, echoes: [], mainEchoId: '6000044', mainEchoSetId: 1,
    }
    expect(collapseScoredDamageTies([single, mixed])).toEqual([single, mixed])
  })

  it('retains a two-set layout when its score ties a single set bonus', () => {
    const single: SetPlanSuggest = {
      setPlan: [{ setId: 23, pieces: 3 }], avgDamage: 9_389_337.79, echoes: [],
    }
    const mixed: SetPlanSuggest = {
      setPlan: [{ setId: 9, pieces: 2 }, { setId: 31, pieces: 2 }], avgDamage: single.avgDamage, echoes: [],
    }
    expect(collapseScoredDamageTies([single, mixed])).toEqual([single, mixed])
  })

it('distinguishes equal self-stat sets by team damage', () => {
    const context = { setConstLut: new Float32Array(0), setRtMask: 0 } as SuggestContext
    const row = (setId: number, avgDamage: number): SetPlanSuggest => ({
      setPlan: [{ setId, pieces: 5 }],
      displayPlan: [{ setIds: [setId], pieces: 5 }],
      avgDamage,
      echoes: [],
    })
    const grouped = groupEquivalentSetPlans([
      row(24, 9_004_850),
      row(11, 8_351_729),
      row(8, 8_870_517),
      row(13, 8_246_061),
    ], context, 10)

    expect(grouped).toHaveLength(4)
    expect(grouped.find((entry) => entry.setPlan[0]?.setId === 24)?.displayPlan)
      .toEqual([{ pieces: 5, setIds: [24] }])
    expect(grouped.find((entry) => entry.setPlan[0]?.setId === 8)?.displayPlan)
      .toEqual([{ pieces: 5, setIds: [8] }])
  })

  it('combines genuinely equal scored alternatives', () => {
    const context = { setConstLut: new Float32Array(0), setRtMask: 0 } as SuggestContext
    const results: SetPlanSuggest[] = [24, 11].map((setId) => ({
      setPlan: [{ setId, pieces: 2 }],
      displayPlan: [{ setIds: [setId], pieces: 2 }],
      avgDamage: 8_351_729,
      echoes: [],
    }))

    expect(groupEquivalentSetPlans(results, context, 10)).toEqual([
      { ...results[0], displayPlan: [{ pieces: 2, setIds: [11, 24] }] },
    ])
  })

  it('retains independent plans even when they have equal scores and equal bonus counts', () => {
    const row = (setId: number, pieces: number, avgDamage: number): SetPlanSuggest => ({
      setPlan: [{ setId, pieces }],
      avgDamage,
      echoes: [],
    })
    const distinct = row(4, 2, 11_010_000)
    const better = row(20, 3, 11_090_000)
    const otherSet = row(34, 5, 11_010_000)

    expect(collapseScoredDamageTies([distinct, better, otherSet])).toEqual([better, distinct, otherSet])
  })

  it('deduplicates reordered copies of the same concrete plan', () => {
    const plan: SetPlanSuggest = {
      setPlan: [{ setId: 9, pieces: 2 }, { setId: 31, pieces: 2 }], avgDamage: 100, echoes: [],
    }
    expect(collapseScoredDamageTies([plan, { ...plan, setPlan: [...plan.setPlan].reverse() }])).toEqual([plan])
  })
})
