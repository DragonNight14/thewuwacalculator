/*
  Author: Runor Ewhro
  description: verifies legal substat allocation, shared budgets, and ranking constraints.
*/

import { describe, expect, it } from 'vitest'
import { getSbstStepP, SUBSTAT_KEYS } from '@/data/gameData/catalog/echoStats'
import { listChsByCos } from '@/data/catalog/echoCatalogService'
import type { EchoInstance } from '@/domain/entities/runtime'
import { ECHO_STAT_STRIDE } from '@/engine/search/layout/constants'
import { addStatTotal, sumEncodedStats } from '@/engine/evaluation/stats'
import {
  distributeStepSubstats, prepareStepAllocator, REFERENCE_STEP_MODEL,
  stepSubstatPlan, tierStepIncreases,
} from '@/engine/evaluation/stepAllocation'
import { auditFixedLineTiers } from '@/engine/evaluation/stepAllocationAudit'

const tiers = () => Object.fromEntries(SUBSTAT_KEYS.map(key => [key, getSbstStepP(key)]))
const base = () => new Float32Array(ECHO_STAT_STRIDE * 5)
const ids = Int32Array.from([0, 1, 2, 3, 4])
const relevantKeys = ['atkPercent', 'atkFlat', 'critRate', 'critDmg', 'heavyAtk']
// minimum-value ranking is cr > cd > atk% > heavy attack > flat atk, independently of er.
const score = (stats: Float32Array) => {
  const totals = sumEncodedStats(stats, ids)
  return totals.critRate * 10 + totals.critDmg * 2 + totals.atkP + totals.heavy * 0.5 + totals.atkF * 0.05
}
const relevantCount = (values: Record<string, number[]>, keys = relevantKeys) => (
  Object.entries(values).reduce((sum, [key, entries]) => (
    sum + (keys.includes(key) || key === 'energyRegen' ? entries.length : 0)
  ), 0)
)

describe('native evaluation slot and step budgets', () => {
  it('audits a fixed line layout exactly with bounded offline work', () => {
    const smallTiers = Object.fromEntries(Object.entries(tiers()).map(([key, steps]) => [key, steps.slice(0, 2)]))
    const allocate = prepareStepAllocator(smallTiers, relevantKeys, 8)
    const result = allocate(base(), 0, score)!
    const audit = auditFixedLineTiers(base(), result, smallTiers, relevantKeys, score,
      { stepBudget: 8, maxEvaluations: 1000 })
    expect(audit.complete).toBe(true)
    expect(audit.evaluations).toBeGreaterThan(1)
    expect(audit.bestDamage).toBeGreaterThanOrEqual(result.damage)
    const replay = base()
    for (const [key, entries] of Object.entries(audit.bestValues)) {
      addStatTotal(replay, key, entries.reduce((sum, value) => sum + value, 0))
    }
    expect(score(replay)).toBe(audit.bestDamage)
    expect(auditFixedLineTiers(base(), result, smallTiers, relevantKeys, score,
      { stepBudget: 8, maxEvaluations: 1 }).complete).toBe(false)
  })

  it('counts adjacent legal tiers, including uneven and short tier lists', () => {
    expect(tierStepIncreases(getSbstStepP('critRate'), 6.3)).toBe(0)
    expect(tierStepIncreases(getSbstStepP('critRate'), 6.9)).toBe(1)
    expect(tierStepIncreases(getSbstStepP('critRate'), 10.5)).toBe(7)
    expect(tierStepIncreases(getSbstStepP('atkFlat'), 40)).toBe(1)
    expect(tierStepIncreases(getSbstStepP('atkFlat'), 60)).toBe(3)
    expect(tierStepIncreases(getSbstStepP('hpFlat'), 390)).toBe(2)
    expect(() => tierStepIncreases(getSbstStepP('critRate'), 7)).toThrow('Invalid substat tier')
    expect(REFERENCE_STEP_MODEL.maxRelevantSubstats).toBe(16)
    expect(REFERENCE_STEP_MODEL.maxStepIncreases).toBe(32)
  })

it('requires two copies of the fifth-ranked damage stat for flat and percent stats', () => {
    const catalog = tiers()
    expect(prepareStepAllocator(catalog, [], 32)(base(), 0, score)).toBeNull()
    const threeStats = prepareStepAllocator(catalog, ['critRate', 'critDmg', 'atkPercent'])(base(), 0, score)!
    expect(threeStats.values.atkPercent.length).toBeGreaterThanOrEqual(2)
    expect(prepareStepAllocator(catalog, relevantKeys, 3)(base(), 0, score)).toBeNull()
    const result = prepareStepAllocator(catalog, relevantKeys, 4)(base(), 0, score)!
    expect(Object.values(result.values).flat()).toHaveLength(25)
    expect(result.stepIncreases).toBe(4)
    expect(result.values.atkFlat).toEqual([50, 50])
    expect(result.values.energyRegen).toBeUndefined()
    for (const [key, values] of Object.entries(result.values)) {
      expect(values.length).toBeLessThanOrEqual(5)
      if (key !== 'atkFlat') expect(values.every(value => value === catalog[key][0])).toBe(true)
    }
    const nonflatKeys = ['critRate', 'critDmg', 'atkPercent', 'heavyAtk', 'resonanceLiberation']
    const nonflatScore = (stats: Float32Array) => {
      const t = sumEncodedStats(stats, ids)
      return t.critRate * 10 + t.critDmg * 2 + t.atkP + t.heavy * 0.5 + t.lib * 0.1
    }
    const nonflat = prepareStepAllocator(catalog, nonflatKeys)(base(), 0, nonflatScore)!
    expect(nonflat.values.resonanceLiberation.length).toBeGreaterThanOrEqual(2)
    expect(nonflat.values.resonanceLiberation.every(value => value >= 9.2)).toBe(true)
  })

it('scores selected tier totals with stable Float32 upgrades', () => {
    const mains = base()
    addStatTotal(mains, 'critDmg', 44)
    const original = mains.slice()
    const allocate = prepareStepAllocator(tiers(), relevantKeys)
    for (const missingEr of [0, 23.1]) {
      const result = allocate(mains, missingEr, score)!
      const expected = mains.slice()
      for (const [key, values] of Object.entries(result.values)) {
        addStatTotal(expected, key, values.reduce((sum, value) => sum + value, 0))
      }
      expect(result.stats).toEqual(expected)
      expect(result.damage).toBe(score(expected))
      expect(mains).toEqual(original)
    }
    const result = allocate(mains, 0, score)!
    expect(result.values.critRate).toEqual([7.5, 7.5, 7.5, 7.5, 7.5])
    expect(result.values.critDmg).toEqual([15, 15, 15, 15, 15])
    expect(sumEncodedStats(result.stats, ids)).toMatchObject({ critRate: 37.5, critDmg: 119 })
    const retainedStats = result.stats.slice()
    const retainedValues = structuredClone(result.values)
    allocate(mains, 23.1, score)
    expect(result.stats).toEqual(retainedStats)
    expect(result.values).toEqual(retainedValues)
  })

  it('charges ER against both limits and realizes five distinct stats on each Echo', () => {
    const catalog = tiers()
    const allocate = prepareStepAllocator(catalog, relevantKeys)
    for (const missingEr of [0, 23.1]) {
      const result = allocate(base(), missingEr, score)!
      const totals = stepSubstatPlan(result.values)
      expect(totals.reduce((sum, entry) => sum + entry.count, 0)).toBe(25)
      expect(result.relevantCount).toBe(16)
      expect(relevantCount(result.values)).toBe(result.relevantCount)
      expect(result.stepIncreases).toBe(32)
      const measured = Object.entries(result.values).reduce((sum, [key, values]) => (
        sum + values.reduce((cost, value) => cost + tierStepIncreases(catalog[key], value), 0)
      ), 0)
      expect(measured).toBe(result.stepIncreases)
      expect(result.values.atkFlat.length).toBeGreaterThanOrEqual(2)
      expect(result.values.atkFlat.every(value => value >= 50)).toBe(true)
      for (const key of ['critRate', 'critDmg']) {
        expect(result.values[key].every(value => tierStepIncreases(catalog[key], value) <= 2), key).toBe(true)
      }
      for (const [key, values] of Object.entries(result.values)) {
        if (relevantKeys.includes(key) || key === 'energyRegen') continue
        expect(values.every(value => value === catalog[key][0]), key).toBe(true)
      }
      const template = Array.from({ length: 5 }, (_, index) => ({
        uid: `step-test-${index}`, id: listChsByCos(1)[0].id, set: 0, mainEcho: index === 0,
        mainStats: { primary: { key: 'atkPercent', value: 18 }, secondary: { key: 'hpFlat', value: 2280 } }, substats: {},
      } as EchoInstance))
      const echoes = distributeStepSubstats(template, result.values)
      expect(template.every(echo => Object.keys(echo.substats).length === 0)).toBe(true)
      for (const echo of echoes) {
        expect(Object.keys(echo.substats)).toHaveLength(5)
        for (const [key, value] of Object.entries(echo.substats)) expect(catalog[key]).toContain(value)
      }
      for (const row of totals) {
        expect(echoes.reduce((sum, echo) => sum + (echo.substats[row.key] ?? 0), 0)).toBeCloseTo(row.total, 10)
      }
      expect(totals.find(row => row.key === 'energyRegen')?.total ?? 0).toBeGreaterThanOrEqual(missingEr)
    }
  })

  it('keeps the ranked budget legal after the finalist refinement pass', () => {
    const catalog = tiers()
    const allocate = prepareStepAllocator(catalog, relevantKeys)
    for (const missingEr of [0, 23.1]) {
      const greedy = allocate(base(), missingEr, score)!
      const refined = allocate(base(), missingEr, score, undefined, true)!
      expect(refined.damage).toBeGreaterThanOrEqual(greedy.damage)
      expect(refined.damage).toBe(score(refined.stats))
      expect(relevantCount(refined.values)).toBe(16)
      expect(Object.values(refined.values).flat()).toHaveLength(25)
      expect(refined.values.atkFlat.length).toBeGreaterThanOrEqual(2)
      expect(refined.values.atkFlat.every(value => value >= 50)).toBe(true)
      expect(refined.values.energyRegen?.reduce((sum, value) => sum + value, 0) ?? 0).toBeGreaterThanOrEqual(missingEr)
      expect(Object.entries(refined.values).reduce((sum, [key, values]) =>
        sum + values.reduce((cost, value) => cost + tierStepIncreases(catalog[key], value), 0), 0)).toBe(32)
      for (const key of ['critRate', 'critDmg']) {
        expect(refined.values[key].every(value => tierStepIncreases(catalog[key], value) <= 2)).toBe(true)
      }
    }
  })

  it('clears a stat lane when refinement moves away its last roll', () => {
    const mains = base()
    addStatTotal(mains, 'atkPercent', 36)
    addStatTotal(mains, 'critDmg', 44)
    const keys = ['critRate', 'critDmg', 'atkPercent', 'atkFlat', 'resonanceSkill']
    const mixedScore = (stats: Float32Array) => {
      const totals = sumEncodedStats(stats, ids)
      return (1000 + totals.atkP * 2 + totals.atkF * 0.4)
        * (1 + totals.critRate * 0.003)
        * (1 + totals.critDmg * 0.0025)
        * (1 + totals.skill * 0.002)
    }
    const result = prepareStepAllocator(tiers(), keys)(mains, 22.8, mixedScore, undefined, true)!
    const replay = mains.slice()
    for (const [key, values] of Object.entries(result.values)) {
      addStatTotal(replay, key, values.reduce((sum, value) => sum + value, 0))
    }
    expect(result.values.atkPercent).toEqual([])
    expect(result.stats).toEqual(replay)
    expect(result.damage).toBe(mixedScore(replay))
  })

  it('preserves the lowest-key floor when ER consumes the rest of the step budget', () => {
    const catalog = tiers()
    const allocate = prepareStepAllocator(catalog, relevantKeys)
    const result = allocate(base(), 56.4000019, score)!
    expect(result.values.energyRegen).toHaveLength(5)
    expect(result.values.energyRegen.reduce((sum, value) => sum + value, 0)).toBeCloseTo(56.4, 8)
    expect(result.values.energyRegen.reduce((sum, value) => sum + tierStepIncreases(catalog.energyRegen, value), 0)).toBe(28)
    expect(result.values.atkFlat).toEqual([50, 50])
    expect(result.stepIncreases).toBe(32)
    expect(relevantCount(result.values)).toBe(16)
    for (const key of ['critRate', 'critDmg']) expect(result.values[key].every(value => value === catalog[key][0])).toBe(true)
    expect(allocate(base(), 56.41, score)).toBeNull()
    expect(allocate(base(), 62.0000019, score)).toBeNull()
  })

it('ranks non-crit keys and exempts ER from damage-ranking caps', () => {
    const rankFlatFirst = (stats: Float32Array) => {
      const t = sumEncodedStats(stats, ids)
      return t.atkF * 10 + t.atkP * 10 + t.critRate + t.critDmg * 0.1
    }
    const result = prepareStepAllocator(tiers(), relevantKeys)(base(), 35, rankFlatFirst)!
    // flat atk ranks first: floor(3 * .29) = 0. atk% ranks second: floor(7 * .29) = 2.
    expect(result.values.atkFlat.every(value => value === 30)).toBe(true)
    expect(result.values.atkPercent.every(value => value <= 7.9)).toBe(true)
    // er leaves no room for cd; the required fifth stat still occupies two slots.
    expect(result.values.critDmg).toHaveLength(0)
    expect(result.values.heavyAtk.length).toBeGreaterThanOrEqual(2)
    expect(result.values.heavyAtk.every(value => value >= 9.2)).toBe(true)
    expect(result.values.energyRegen.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(35)
    expect(result.stepIncreases).toBeLessThanOrEqual(32)
  })

  it('requires both copies of the same fifth-ranked stat and rounds its value floor up', () => {
    const keys = ['atkFlat', 'hpFlat', 'critRate', 'critDmg', 'atkPercent']
    const rankedScore = (stats: Float32Array) => {
      const t = sumEncodedStats(stats, ids)
      return t.critRate * 100 + t.critDmg * 20 + t.atkP * 5 + t.atkF * 0.5 + t.hpF * 0.001
    }
    const result = prepareStepAllocator(tiers(), keys)(base(), 0, rankedScore)!
    expect(result.values.hpFlat.length).toBeGreaterThanOrEqual(2)
    // hp ranks fifth. every selected hp substat must spend ceil(7 / 2) = 4 moves.
    expect(result.values.hpFlat.every(value => value >= 470)).toBe(true)
    expect(result.stepIncreases).toBeLessThanOrEqual(32)
  })

  it('rejects conflicting rank limits', () => {
    // with only two relevant keys, the lowest selected key also has a top-two
    // cap. its half-upgrade floor cannot fit under that cap.
    expect(prepareStepAllocator(tiers(), ['critRate', 'atkFlat'])(base(), 0, score)).toBeNull()
  })

  it('never relabels a weak relevant stat as filler to complete the build', () => {
    const allButHp = SUBSTAT_KEYS.filter(key => key !== 'hpFlat' && key !== 'energyRegen')
    expect(prepareStepAllocator(tiers(), allButHp)(base(), 0, score)).toBeNull()
  })
})
