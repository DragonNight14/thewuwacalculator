/*
  Author: Runor Ewhro
  description: keeps rotation weapon suggestions numerically aligned with the
               canonical simulation after each candidate passive is applied.
*/

import { describe, expect, it } from 'vitest'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario'
import type { ResRuntime } from '@/domain/entities/runtime'
import { makeEnemy, mkDefWpnSug, mkMaxResRt } from '@/engine/runtime/defaults'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { mkPrepWpnSu, resSuggDmg, runSuggSmlt } from '@/engine/suggestions/shared'
import { runPrepWpn } from '@/engine/suggestions/weapon/compute.ts'
import { isOptRotTgt } from '@/engine/search/score/eligibility.ts'

describe('weapon suggestion parity', () => {
  it('scores rotation candidates through their fully materialized runtime', () => {
    const seed = getResSeedBy('1506')
    expect(seed).toBeTruthy()
    if (!seed) throw new Error('missing weapon suggestion fixture resonator')

    const runtime = mkMaxResRt(seed)
    const enemy = makeEnemy()
    const settings = {
      ...mkDefWpnSug(),
      mode: 'default' as const,
      visible: {
        '5': true,
        '4': false,
        '3': false,
        '2': false,
        '1': false,
      },
    }
    const input = {
      scenarioId: combatScenarioId('suggestions:weapon-parity'),
      memberId: teamMemberId(runtime.id),
      runtime,
      seed,
      enemy,
      runtimesById: makeRuntimeMap(runtime),
      selectedTargets: {},
      tgtFeatId: null,
      rotationMode: true,
      includeEchoAttacks: true,
      weapon: settings,
      topK: 5,
    }
    const simulation = runSuggSmlt(input)
    const prep = mkPrepWpnSu(input, simulation)
    expect(prep).toBeTruthy()
    if (!prep) throw new Error('failed to prepare weapon suggestions')
    const compact = mkPrepWpnSu(input, structuredClone({
      finalStats: simulation.finalStats,
      allSkills: simulation.allSkills.filter((entry) => isOptRotTgt(entry, runtime.id, { includeEchoAttacks: true })),
      rotation: { sequence: { entries: simulation.rotation.sequence.entries.filter(
        (entry) => isOptRotTgt(entry, runtime.id, { includeEchoAttacks: true }),
      ) } },
    }))
    expect(compact?.context.mode).toBe(prep.context.mode)
    if (compact?.context.mode === 'rotation' && prep.context.mode === 'rotation') {
      expect(compact.context.contexts).toEqual(prep.context.contexts)
    }

    const results = runPrepWpn(prep)
    expect(results).not.toHaveLength(0)

    for (const result of results) {
      const candidate: ResRuntime = {
        ...prep.runtime,
        build: {
          ...prep.runtime.build,
          weapon: {
            id: result.weaponId,
            level: result.level,
            rank: result.rank,
            baseAtk: result.baseAtk,
          },
        },
        state: {
          ...prep.runtime.state,
          controls: {
            ...prep.runtime.state.controls,
            ...result.controls,
          },
        },
      }
      const candidateInput = { ...input, runtime: candidate }
      const expected = resSuggDmg(runSuggSmlt(candidateInput), candidateInput)

      expect(result.damage).toBeCloseTo(expected, 8)
    }
  })
})
