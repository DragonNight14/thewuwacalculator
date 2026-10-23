/*
  Author: Runor Ewhro
  description: applies set-plan assignments onto the current echo loadout
               and evaluates the resulting damage for direct or rotation
               suggestion contexts.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import type { SuggestContext } from '@/engine/suggestions/types'
import { applySetPlan } from '@/engine/suggestions/mutate'
import { evalSuggChsW, mkNeutralSuggMainEc, type SuggestionScoreCandidate } from '@/engine/suggestions/shared'
import type { SetPlanEntry } from '@/engine/search/combos/setPlans'

const neutralCandidates = new WeakMap<SuggestContext, Map<string, SuggestionScoreCandidate>>()

/** share materialization between cold-worker precomputation and the serial
 * selection pass. UIDs are presentation identities, not scoring inputs. */
export function prepareNeutralSetCandidate(
    ctx: SuggestContext,
    setPlan: SetPlanEntry[],
    echoes: Array<EchoInstance | null>,
): SuggestionScoreCandidate {
  let cache = neutralCandidates.get(ctx)
  if (!cache) {
    cache = new Map()
    neutralCandidates.set(ctx, cache)
  }
  const key = JSON.stringify([setPlan, echoes.map((echo) => echo && [
    echo.id, echo.set, echo.mainEcho, echo.mainStats, echo.substats,
  ])])
  const known = cache.get(key)
  if (known) return known
  const candidateEchoes = applySetPlan(setPlan, echoes)
  const candidate = { echoes: candidateEchoes, mainEchoBuffs: mkNeutralSuggMainEc(candidateEchoes), selfMainEchoEffects: false }
  if (cache.size >= 8192) cache.delete(cache.keys().next().value!)
  cache.set(key, candidate)
  return candidate
}

// compute damage for one set-plan configuration
export function calcSetPlan(
    ctx: SuggestContext,
    setPlan: SetPlanEntry[],
    qppdChs: Array<EchoInstance | null>,
): { avgDamage: number; baseDamage: number } {
  // materialize the candidate set assignment first
  const candidate = prepareNeutralSetCandidate(ctx, setPlan, qppdChs)
  const avgDamage = evalSuggChsW(ctx, candidate.echoes, candidate.mainEchoBuffs, candidate.selfMainEchoEffects)

  // baseDamage currently mirrors avgDamage for this suggestion path
  return {
    avgDamage,
    baseDamage: avgDamage,
  }
}

// compute set-plan damage with additional rotation metadata
export function calcRotSetPlan(
    ctx: SuggestContext,
    setPlan: SetPlanEntry[],
    qppdChs: Array<EchoInstance | null>,
): { avgDamage: number; baseDamage: number; isRotation: boolean; contextCount: number } {
  const result = calcSetPlan(ctx, setPlan, qppdChs)

  return {
    ...result,
    isRotation: true,
    contextCount: ctx.mode === 'rotation' ? ctx.contextCount : 1,
  }
}
