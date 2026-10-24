/*
  Author: Runor Ewhro
  description: verifies suggestions retain grouped equivalents while
               applying the concrete set plan whose damage was scored.
*/

import { describe, expect, it } from 'vitest'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { mkMaxResRt } from '@/engine/runtime/defaults'
import { buildRows } from '../model.ts'

describe('set-plan suggestion rows', () => {
  it('shows grouped equivalent sets and keeps the scored concrete plan for Apply', () => {
    const seed = getResSeedBy('1208')
    if (!seed) throw new Error('Missing Galbrena fixture')
    const runtime = mkMaxResRt(seed, 6)
    const concrete = [{ setId: 24, pieces: 5 }]
    const rows = buildRows({
      kind: 'setPlans',
      mainStatRslt: [],
      setPlanRslt: [{
        avgDamage: 8_140_976,
        setPlan: concrete,
        displayPlan: [{ setIds: [11, 24], pieces: 5 }],
      }],
      wpnRslt: [],
      base: 3_963_995,
      echoes: [],
      worn: [],
      wornSetPlan: [{ setId: 11, pieces: 5 }],
      runtime,
    })

    expect(rows[0].setPlan).toEqual(concrete)
    expect(rows[0].trays[0].name).toBe(getSntSetNam(11))
    expect(rows[0].trays[0].names).toEqual([getSntSetNam(11), getSntSetNam(24)])
    expect(rows[0].trays[0].coins).toHaveLength(2)
    expect(rows[0].damage).toBe(8_140_976)
  })

  it('names the scored main echo and keeps a main-only plan concrete', () => {
    const seed = getResSeedBy('1208')
    if (!seed) throw new Error('Missing Galbrena fixture')
    const runtime = mkMaxResRt(seed, 6)
    // fallacy of No Return seats on Rejuvenating Glow (7); Lingering Tunes is 9.
    const plan = [{ setId: 9, pieces: 2 }, { setId: 7, pieces: 2 }]
    const row = (setPlan: typeof plan) => buildRows({
      kind: 'setPlans',
      mainStatRslt: [],
      setPlanRslt: [{
        avgDamage: 1_641_999,
        setPlan,
        displayPlan: setPlan.map((entry) => ({ setIds: [entry.setId], pieces: entry.pieces })),
        mainEchoId: '6000060',
        mainEchoSetId: 7,
      }],
      wpnRslt: [],
      base: 1_871_257,
      echoes: [],
      worn: [],
      wornSetPlan: [],
      runtime,
    })[0]

    const live = row(plan)
    expect(live.echo?.id).toBe('6000060')
    expect(live.echo?.seat).toBe(1)
    expect(live.echo?.worn).toBe(false)
    const solo = row([])
    expect(solo.trays).toEqual([])
    expect(solo.setPlan).toEqual([])
    expect(solo.echo?.seat).toBe(-1)
  })
})
