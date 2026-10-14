/*
  Author: Runor Ewhro
  description: selects the fixed showcase stat rows from build and combat values.
*/

import type { StatViewRow, StatsView } from '@/modules/simulation/model/statsView.ts'

const OPTIONAL_SECONDARY_KEYS = new Set(['healingBonus', 'tuneBreakBoost'])
const ZERO_EPSILON = 0.000001

function nonzero(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) > ZERO_EPSILON
}

export function buildTotalsByKey(view: StatsView | null): Map<string, number> {
  const totals = new Map<string, number>()
  for (const row of [
    ...(view?.mainStats ?? []),
    ...(view?.secondaryStats ?? []),
    ...(view?.dmgMdfrStts ?? []),
  ]) {
    totals.set(row.key, row.total)
  }
  return totals
}

export function showcaseSecondaryRows(combat: StatsView, build: StatsView | null): StatViewRow[] {
  const buildTotals = buildTotalsByKey(build)
  const replaceable = (row: StatViewRow) => OPTIONAL_SECONDARY_KEYS.has(row.key)
    && buildTotals.has(row.key)
    && !nonzero(row.total)
    && !nonzero(buildTotals.get(row.key) ?? 0)

  const fixed = combat.secondaryStats.filter((row) => !OPTIONAL_SECONDARY_KEYS.has(row.key))
  const activeOptional = combat.secondaryStats.filter((row) => OPTIONAL_SECONDARY_KEYS.has(row.key) && !replaceable(row))
  const fallback = combat.secondaryStats.filter(replaceable)
  const modifiers = combat.dmgMdfrStts
    .filter((row) => nonzero(row.total) || nonzero(buildTotals.get(row.key) ?? 0))
    .sort((a, b) => (b.total - a.total)
      || ((buildTotals.get(b.key) ?? 0) - (buildTotals.get(a.key) ?? 0)))

  return [...fixed, ...activeOptional, ...modifiers, ...fallback].slice(0, combat.secondaryStats.length)
}
