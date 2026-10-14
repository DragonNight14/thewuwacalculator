/*
  Author: Runor Ewhro
  description: verifies worker-cloned main-stat and sonata candidates retain
               canonical simulation scores and legal search-space membership.
*/

import { describe, expect, it } from 'vitest'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario'
import type { EchoInstance } from '@/domain/entities/runtime'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import { makeEnemy, mkMaxResRt } from '@/engine/runtime/defaults'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { mkPrepMainSt, mkPrepSetPla, resSuggDmg, runSuggSmlt } from '@/engine/suggestions/shared'
import { runMainStats, runSetPlanqc } from '@/engine/suggestions/core'
import { applyMainSta } from '@/engine/suggestions/mainStat-suggestion/utils'
import { applySetPlan } from '@/engine/suggestions/mutate'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import { sggsSetPlns } from '@/engine/suggestions/setPlan-suggestion/suggestSetPlan'
import { isOptRotTgt } from '@/engine/optimizer/rules/eligibility.ts'

describe('main-stat suggestion worker payload', () => {
  it.each([true, false])('returns canonical Galbrena scores after structured clone (rotation: %s)', (rotationMode) => {
    const seed = getResSeedBy('1208')
    if (!seed) throw new Error('Missing Galbrena fixture')
    const runtime = mkMaxResRt(seed, 6)
    runtime.build.echoes = ['6000120', '6000068', '6000169', '6000112', '6000167'].map((id, index): EchoInstance => {
      const definition = getEchoById(id)
      if (!definition) throw new Error(`Missing Echo ${id}`)
      const cost = definition.cost
      const primaryKey = cost === 4 ? 'critDmg' : cost === 3 ? 'fusion' : 'atkPercent'
      return {
        uid: `galbrena-main-${index}`, id, set: index === 0 || index === 3 ? 18 : 22,
        mainEcho: index === 0,
        mainStats: {
          primary: { key: primaryKey, value: ECHO_MAIN_STATS[cost][primaryKey] },
          secondary: { ...ECHO_SIDE_STATS[cost] },
        },
        substats: { critRate: 10.5, critDmg: 21, atkPercent: 11.6, heavyAtk: 11.6, energyRegen: 12.4 },
      }
    })
    const input = {
      scenarioId: combatScenarioId('suggestions:main-parity'), memberId: teamMemberId(runtime.id),
      runtime, seed, enemy: makeEnemy(), runtimesById: makeRuntimeMap(runtime),
      selectedTargets: {}, tgtFeatId: 'damage:1208018', rotationMode,
      includeEchoAttacks: true, topK: 3,
    }
    const simulation = runSuggSmlt(input)
    const prepared = mkPrepMainSt(input, simulation)
    if (!prepared) throw new Error('Failed to prepare main-stat suggestions')
    const compactSimulation = structuredClone({
      finalStats: simulation.finalStats,
      allSkills: simulation.allSkills.filter((entry) => isOptRotTgt(entry, runtime.id, { includeEchoAttacks: true })),
      rotation: { sequence: { entries: simulation.rotation.sequence.entries.filter(
        (entry) => isOptRotTgt(entry, runtime.id, { includeEchoAttacks: true }),
      ) } },
    })
    const compactMain = mkPrepMainSt(input, compactSimulation)
    expect(compactMain?.statWeight).toEqual(prepared.statWeight)
    expect(compactMain?.context.mode).toBe(prepared.context.mode)
    if (compactMain?.context.mode === 'rotation' && prepared.context.mode === 'rotation') {
      expect(compactMain.context.contexts).toEqual(prepared.context.contexts)
    } else if (compactMain?.context.mode === 'target' && prepared.context.mode === 'target') {
      expect(compactMain.context.pckdCtx).toEqual(prepared.context.pckdCtx)
    }
    // worker transfer must retain every input needed for finalist simulation.
    const transferred = structuredClone(prepared)
    expect(transferred.scoringInput.runtime.id).toBe('1208')
    expect(transferred.scoringInput.includeEchoAttacks).toBe(true)
    const results = runMainStats(transferred)
    expect(results).toHaveLength(3)
    expect(results[0].damage).toBeGreaterThanOrEqual(resSuggDmg(simulation, input) - 1e-6)
    results.forEach((result, index) => {
      const candidate = { ...input, runtime: { ...runtime, build: { ...runtime.build, echoes: applyMainSta(result.recipes, runtime.build.echoes) } } }
      expect(result.damage).toBeCloseTo(resSuggDmg(runSuggSmlt(candidate), candidate), 8)
      if (index) expect(result.damage).toBeLessThanOrEqual(results[index - 1].damage)
    })
    const preparedSets = mkPrepSetPla({ ...input, includeEchoAttacks: undefined }, simulation)
    if (!preparedSets) throw new Error('Failed to prepare Sonata suggestions')
    const compactSets = mkPrepSetPla({ ...input, includeEchoAttacks: undefined }, compactSimulation)
    expect(compactSets?.context.mode).toBe(preparedSets.context.mode)
    if (compactSets?.context.mode === 'rotation' && preparedSets.context.mode === 'rotation') {
      expect(compactSets.context.contexts).toEqual(preparedSets.context.contexts)
    } else if (compactSets?.context.mode === 'target' && preparedSets.context.mode === 'target') {
      expect(compactSets.context.pckdCtx).toEqual(preparedSets.context.pckdCtx)
    }
    const setResults = runSetPlanqc(structuredClone(preparedSets))
    expect(setResults.length).toBeGreaterThan(0)
    // changing echo bodies during full simulation must not reintroduce plans
    // suppressed by the original isolated useful-piece comparisons.
    const isolated = sggsSetPlns({
      ctx: rotationMode ? null : preparedSets.context,
      rotationCtx: rotationMode ? preparedSets.context : null,
      fivePcSets: ECHO_SET_DEFS.filter((set) => set.setMax === 5).map((set) => set.id),
      thrPcSets: ECHO_SET_DEFS.filter((set) => set.setMax === 3).map((set) => set.id),
      exhaustive: true, qppdChs: runtime.build.echoes,
    }).results
    const signature = (plan: typeof setResults[number]['setPlan']) => JSON.stringify(plan)
    const usefulSignatures = new Set(isolated.map((result) => signature(result.setPlan)))
    for (const result of setResults) {
      expect(usefulSignatures.has(signature(result.setPlan))).toBe(true)
      const candidate = { ...input, runtime: { ...runtime, build: { ...runtime.build, echoes: applySetPlan(result.setPlan, runtime.build.echoes) } } }
      expect(result.avgDamage).toBeCloseTo(resSuggDmg(runSuggSmlt(candidate), candidate), 8)
    }
  }, 30_000)
})
