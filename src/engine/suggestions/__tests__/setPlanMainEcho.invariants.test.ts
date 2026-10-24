/*
  Author: Runor Ewhro
  description: verifies set plans contain only contributing bonuses and
               materialize the main Echo whose damage was scored.
*/

import { describe, expect, it } from 'vitest'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario'
import type { EchoInstance } from '@/domain/entities/runtime'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import { makeEnemy, mkMaxResRt } from '@/engine/runtime/defaults'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { getEchoById, getEchoSets, listChsByCos } from '@/data/catalog/echoCatalogService'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { evalSuggChs, mkPrepSetPla, runSuggSmlt } from '@/engine/suggestions/shared'
import { runSetPlanqc } from '@/engine/suggestions/core'
import { applySetPlan } from '@/engine/suggestions/mutate'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import { maxEchoStts } from '@/engine/runtime/sourceStateInit'
import { runSetSggs } from '@/engine/suggestions/setPlan/suggest'

describe('set plan main echo', () => {
  it.each([
    { name: 'Glacio damage', sets: [1, 30] },
    { name: 'ATK', sets: [9, 31] },
  ])('ranks mains while retaining feasible off-set choices with two 2pc $name bonuses', ({ sets }) => {
    const seed = getResSeedBy('1109')!
    let runtime = mkMaxResRt(seed)
    const used = new Set<string>()
    runtime.build.echoes = [4, 3, 3, 1, 1].map((cost, index): EchoInstance => {
      const definition = index === 0 ? getEchoById('6000052')!
        : listChsByCos(cost).find((entry) => entry.sets.includes(8) && !used.has(entry.id))!
      used.add(definition.id)
      const primaryKey = cost === 4 ? 'critDmg' : cost === 3 ? 'glacio' : 'atkPercent'
      return {
        uid: `lucilla-off-set-main-${index}`, id: definition.id, set: 8, mainEcho: index === 0,
        mainStats: { primary: { key: primaryKey, value: ECHO_MAIN_STATS[cost][primaryKey] }, secondary: { ...ECHO_SIDE_STATS[cost] } },
        substats: { critRate: 6.9, critDmg: 13.8, atkPercent: 7.1 },
      }
    })
    runtime = maxEchoStts(runtime)
    const input = {
      scenarioId: combatScenarioId('suggestions:off-set-main'), memberId: teamMemberId(runtime.id),
      runtime, seed, enemy: makeEnemy(), runtimesById: makeRuntimeMap(runtime),
      selectedTargets: {}, tgtFeatId: null, rotationMode: true, topK: 80,
    }
    const result = runSetSggs(input, { fivePcSets: sets, thrPcSets: [], topK: 80 })
      .results.find((entry) => entry.setPlan.length === 2
        && sets.every((setId) => entry.setPlan.some((part) => part.setId === setId && part.pieces === 2)))
    expect(result).toBeDefined()
    const preserved = applySetPlan(result!.setPlan, runtime.build.echoes, { id: '6000052', setId: 8 })
    expect(preserved[0]?.id).toBe('6000052')
    expect(preserved[0]?.set).toBe(8)
    const echoes = applySetPlan(result!.setPlan, runtime.build.echoes, { id: result!.mainEchoId!, setId: result!.mainEchoSetId! })
    expect(echoes[0]?.id).toBe(result!.mainEchoId)
    expect(echoes[0]?.set).toBe(result!.mainEchoSetId)
    for (const setId of sets) expect(echoes.filter((echo) => echo?.set === setId)).toHaveLength(2)
    const prepared = mkPrepSetPla(input, runSuggSmlt(input))!
    expect(result!.avgDamage).toBeCloseTo(evalSuggChs(prepared.context, echoes), 1)
    expect(result!.avgDamage).toBeGreaterThanOrEqual(evalSuggChs(prepared.context, preserved))
  }, 30_000)

  it('keeps the scored main Echo and omits sets that only include it', () => {
    const seed = getResSeedBy('1208')
    if (!seed) throw new Error('Missing Galbrena fixture')
    const runtime = mkMaxResRt(seed, 6)
    // fallacy of No Return seats on Rejuvenating Glow, whose healing does nothing for Galbrena.
    runtime.build.echoes = ['6000060', '6000068', '6000169', '6000112', '6000167'].map((id, index): EchoInstance => {
      const definition = getEchoById(id)
      if (!definition) throw new Error(`Missing Echo ${id}`)
      const cost = definition.cost
      const primaryKey = cost === 4 ? 'critDmg' : cost === 3 ? 'fusion' : 'atkPercent'
      return {
        uid: `galbrena-echo-${index}`, id, set: index === 0 ? 7 : index === 3 ? 18 : 22,
        mainEcho: index === 0,
        mainStats: {
          primary: { key: primaryKey, value: ECHO_MAIN_STATS[cost][primaryKey] },
          secondary: { ...ECHO_SIDE_STATS[cost] },
        },
        substats: { critRate: 10.5, critDmg: 21, atkPercent: 11.6, heavyAtk: 11.6, energyRegen: 12.4 },
      }
    })
    const input = {
      scenarioId: combatScenarioId('suggestions:main-echo'), memberId: teamMemberId(runtime.id),
      runtime, seed, enemy: makeEnemy(), runtimesById: makeRuntimeMap(runtime),
      selectedTargets: {}, tgtFeatId: 'damage:1208018', rotationMode: true,
      topK: 80,
    }
    const prepared = mkPrepSetPla(input, runSuggSmlt(input))
    if (!prepared) throw new Error('Failed to prepare Sonata suggestions')
    const { results } = runSetPlanqc(structuredClone(prepared))
    expect(results.length).toBeGreaterThan(0)

    let mainOnly = 0
    for (const result of results) {
      if (result.mainEchoSetId == null) continue
      expect(getEchoSets(result.mainEchoId!)).toContain(result.mainEchoSetId)

      const echoes = applySetPlan(result.setPlan, runtime.build.echoes, { id: result.mainEchoId!, setId: result.mainEchoSetId })
      expect(echoes[0]?.id).toBe(result.mainEchoId)
      expect(echoes[0]?.set).toBe(result.mainEchoSetId)
      const counts = new Map<number, number>()
      for (const echo of echoes) {
        if (!echo) continue
        expect(getEchoSets(echo.id), `${echo.id} with set ${echo.set} in ${JSON.stringify(result.setPlan)}`).toContain(echo.set)
        counts.set(echo.set, (counts.get(echo.set) ?? 0) + 1)
      }
      for (const [setId, pieces] of counts) {
        const max = ECHO_SET_DEFS.find((set) => set.id === setId)?.setMax
        const threshold = max === 1 ? 1 : max === 3 ? 3 : 2
        if (pieces >= threshold) expect(result.setPlan.some((entry) => entry.setId === setId)).toBe(true)
      }
      const full = evalSuggChs(prepared.context, echoes)
      expect(full).toBeCloseTo(result.avgDamage, 1)
      if (result.setPlan.length === 0) mainOnly += 1

      for (const [index, entry] of result.setPlan.entries()) {
        if (entry.setId === result.mainEchoSetId
          && ECHO_SET_DEFS.find((set) => set.id === entry.setId)?.setMax === 1) continue
        const reduced = applySetPlan(result.setPlan.filter((_, at) => at !== index), runtime.build.echoes, {
          id: result.mainEchoId!, setId: result.mainEchoSetId,
        })
        if (reduced[0]?.id !== result.mainEchoId || reduced[0]?.set !== result.mainEchoSetId) continue
        const without = evalSuggChs(prepared.context, reduced)
        expect(Math.abs(full - without)).toBeGreaterThan(Math.max(1e-6, Math.abs(full) * 1e-6))
        if (entry.pieces === 5) {
          const lower = applySetPlan(result.setPlan.map((part, at) => at === index ? { ...part, pieces: 2 } : part), runtime.build.echoes, {
            id: result.mainEchoId!, setId: result.mainEchoSetId,
          })
          if (lower[0]?.id === result.mainEchoId && lower[0]?.set === result.mainEchoSetId) {
            expect(Math.abs(full - evalSuggChs(prepared.context, lower)))
              .toBeGreaterThan(Math.max(1e-6, Math.abs(full) * 1e-6))
          }
        }
      }
    }
    expect(mainOnly).toBeGreaterThan(0)

    const choice = { id: '6000060', setId: 7 }
    const fivePiece = applySetPlan([{ setId: 7, pieces: 5 }], runtime.build.echoes, choice)
    expect(fivePiece.filter((echo) => echo?.set === 7)).toHaveLength(5)
    const fillerBuild = applySetPlan([], fivePiece, choice)
    expect(fillerBuild[0]?.id).toBe(choice.id)
    expect(fillerBuild[0]?.set).toBe(choice.setId)
    const fillerCounts = new Map<number, number>()
    for (const echo of fillerBuild) {
      if (!echo) continue
      expect(getEchoSets(echo.id)).toContain(echo.set)
      fillerCounts.set(echo.set, (fillerCounts.get(echo.set) ?? 0) + 1)
    }
    for (const [setId, pieces] of fillerCounts) {
      const max = ECHO_SET_DEFS.find((set) => set.id === setId)?.setMax
      expect(pieces).toBeLessThan(max === 1 ? 1 : max === 3 ? 3 : 2)
    }
  }, 30_000)
})
