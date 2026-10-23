/*
  Author: Runor Ewhro
  description: shared optimizer stat-constraint encoding and evaluation
               helpers used by compiler, cpu, and evaluators.
*/

import type { OptSets } from '@/domain/entities/optimizer.ts'

const DISABLED_MIN = 1
const DISABLED_MAX = 0

export const DISABLED_CONSTRAINTS = new Float32Array([
  DISABLED_MIN, DISABLED_MAX,
  DISABLED_MIN, DISABLED_MAX,
  DISABLED_MIN, DISABLED_MAX,
  DISABLED_MIN, DISABLED_MAX,
  DISABLED_MIN, DISABLED_MAX,
  DISABLED_MIN, DISABLED_MAX,
  DISABLED_MIN, DISABLED_MAX,
  DISABLED_MIN, DISABLED_MAX,
])

function inRange(value: number, min: number, max: number): boolean {
  if (min > max) {
    return true
  }

  return value >= min && value <= max
}

// layout:
// [atkMin, atkMax, hpMin, hpMax, defMin, defMax, crMin, crMax,
//  cdMin, cdMax, erMin, erMax, bonusMin, bonusMax, damageMin, damageMax]
export function psssCstrs(
    constraints: Float32Array,
    atk: number,
    hp: number,
    def: number,
    critRate: number,
    critDmg: number,
    er: number,
    dmgBonus: number,
    damage: number,
): boolean {
  return (
      inRange(atk, constraints[0], constraints[1]) &&
      inRange(hp, constraints[2], constraints[3]) &&
      inRange(def, constraints[4], constraints[5]) &&
      inRange(critRate, constraints[6], constraints[7]) &&
      inRange(critDmg, constraints[8], constraints[9]) &&
      inRange(er, constraints[10], constraints[11]) &&
      inRange(dmgBonus, constraints[12], constraints[13]) &&
      inRange(damage, constraints[14], constraints[15])
  )
}

export function encStatCstrs(settings: OptSets): Float32Array {
  const values = new Float32Array(DISABLED_CONSTRAINTS)

  const slots: Array<[keyof OptSets['statConstraints'], number]> = [
    ['atk', 0],
    ['hp', 2],
    ['def', 4],
    ['cr', 6],
    ['cd', 8],
    ['er', 10],
    ['bonus', 12],
    ['damage', 14],
  ]

  for (const [key, offset] of slots) {
    const rule = settings.statConstraints[key]
    if (!rule) continue

    const hasMin = rule.minTotal != null && rule.minTotal.trim() !== ''
    const hasMax = rule.maxTotal != null && rule.maxTotal.trim() !== ''
    if (!hasMin && !hasMax) continue

    const minValue = hasMin ? Number(rule.minTotal) : Number.NEGATIVE_INFINITY
    const maxValue = hasMax ? Number(rule.maxTotal) : Number.POSITIVE_INFINITY

    values[offset] = Number.isFinite(minValue) ? minValue : Number.NEGATIVE_INFINITY
    values[offset + 1] = Number.isFinite(maxValue) ? maxValue : Number.POSITIVE_INFINITY
  }

  return values
}

// limits are typed as displayed (crit 75 = 75%, bonus 40 = +40%). target
// scorers compare crit as a ratio and damage bonus as a multiplier, so convert
// once here instead of per evaluation. rotation programs compare display
// outputs and take encStatCstrs as is.
export function encTgtStatCstrs(settings: OptSets): Float32Array {
  const values = encStatCstrs(settings)
  for (const slot of [6, 7, 8, 9]) values[slot] = values[slot]! / 100
  for (const slot of [12, 13]) values[slot] = values[slot]! / 100 + 1
  return values
}
