/*
  Author: Runor Ewhro
  Description: Applies set-plan assignments onto the current echo loadout
               and evaluates the resulting damage for direct or rotation
               suggestion contexts.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import type { SuggestContext } from '@/engine/suggestions/types'
import { applySetPlan } from '@/engine/suggestions/mutate'
import { evalSuggChsW, mkNeutralSuggMainEc } from '@/engine/suggestions/shared'
import type { SetPlanEntry } from '@/engine/suggestions/types'

// compute damage for one set-plan configuration
export function calcSetPlan(
    ctx: SuggestContext,
    setPlan: SetPlanEntry[],
    qppdChs: Array<EchoInstance | null>,
): { avgDamage: number; baseDamage: number } {
  // materialize the candidate set assignment first
  const echoes = applySetPlan(setPlan, qppdChs)

  const avgDamage = evalSuggChsW(ctx, echoes, mkNeutralSuggMainEc(echoes))

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
