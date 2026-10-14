/*
  Author: Runor Ewhro
  description: keeps showcase's two optional stat slots aligned across build and combat.
*/

import { describe, expect, it } from 'vitest'
import type { StatViewRow, StatsView } from '@/modules/simulation/model/statsView.ts'
import { buildTotalsByKey, showcaseSecondaryRows } from '../showcaseStats.ts'

function row(key: string, total: number): StatViewRow {
  return { key, label: key, base: 0, bonus: total, total }
}

function view(healing: number, tbb: number, modifiers: Array<[string, number]> = []): StatsView {
  return {
    mainStats: [row('atkFlat', 100), row('hpFlat', 1000), row('defFlat', 100)],
    secondaryStats: [row('energyRegen', 100), row('critRate', 5), row('critDmg', 150), row('healingBonus', healing), row('tuneBreakBoost', tbb)],
    dmgMdfrStts: modifiers.map(([key, value]) => row(key, value)),
  }
}

function keys(combat: StatsView, build: StatsView): string[] {
  return showcaseSecondaryRows(combat, build).map((entry) => entry.key)
}

describe('Showcase optional stat slots', () => {
  it('fills zero optional stats with the highest nonzero damage modifiers', () => {
    const combat = view(0, 0, [['aero', 0], ['fusion', 12], ['basicAtk', 19], ['heavyAtk', 4]])
    const build = view(0, 0, [['aero', 0], ['fusion', 0], ['basicAtk', 8], ['heavyAtk', 4]])

    expect(keys(combat, build)).toEqual(['energyRegen', 'critRate', 'critDmg', 'basicAtk', 'fusion'])
    expect(buildTotalsByKey(build).get('basicAtk')).toBe(8)
  })

  it('keeps nonzero optional stats ahead of modifiers, including a Build-only value', () => {
    expect(keys(
      view(0, 7, [['fusion', 12], ['basicAtk', 9]]),
      view(0, 0, [['fusion', 0], ['basicAtk', 0]]),
    )).toEqual(['energyRegen', 'critRate', 'critDmg', 'tuneBreakBoost', 'fusion'])

    expect(keys(
      view(0, 7, [['fusion', 12]]),
      view(0, 0, [['fusion', 0]]),
    )).toEqual(['energyRegen', 'critRate', 'critDmg', 'tuneBreakBoost', 'fusion'])

    expect(keys(
      view(0, 0, [['fusion', 12]]),
      view(5, 0, [['fusion', 0]]),
    )).toEqual(['energyRegen', 'critRate', 'critDmg', 'healingBonus', 'fusion'])
  })

  it('uses Healing Bonus before Tune Break Boost when modifiers run out', () => {
    expect(keys(view(0, 0), view(0, 0)))
      .toEqual(['energyRegen', 'critRate', 'critDmg', 'healingBonus', 'tuneBreakBoost'])
    expect(keys(view(0, 0, [['fusion', 0]]), view(0, 0, [['fusion', 8]])))
      .toEqual(['energyRegen', 'critRate', 'critDmg', 'fusion', 'healingBonus'])
  })

  it('uses Build totals to break Combat ties', () => {
    expect(keys(
      view(0, 0, [['fusion', 12], ['basicAtk', 12]]),
      view(0, 0, [['fusion', 3], ['basicAtk', 8]]),
    )).toEqual(['energyRegen', 'critRate', 'critDmg', 'basicAtk', 'fusion'])
  })
})
