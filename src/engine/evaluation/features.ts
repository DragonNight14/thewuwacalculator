/*
  Author: Runor Ewhro
  description: evaluates encoded echo loadouts across objective contexts and
               derives each skill's weighted contribution to the result.
*/

import type { EchoInstance } from '@/domain/entities/runtime';

import { encEchoRows } from '@/engine/search/encode/echoes';

import { mkSuggMainEc } from '@/engine/suggestions/shared';

import type { SuggestContext } from '@/engine/suggestions/types';

import { evalTarget } from '@/engine/search/score/evaluate';

import type { EvaluationFeature } from './types.ts';
import { evaluationRotationDetails } from './rotationScoring';

export function buildEvaluationFeatureBreakdown(
  ctx: SuggestContext,
  equipped: Array<EchoInstance | null>,
): EvaluationFeature[] {
  const echoes = equipped.filter((echo): echo is EchoInstance => echo != null)
  if (echoes.length === 0) {
    return []
  }

  const mainEchoBuffs = mkSuggMainEc(ctx, equipped)
  const { stats, sets, kinds } = encEchoRows(echoes, ctx.selectedSkill, 'self')
  const comboIds = Int32Array.from(echoes.map((_, index) => index))
  const mainIndex = Math.max(0, echoes.findIndex((echo) => echo.mainEcho))

  return buildEvaluationFeatureBreakdownFromEncoded(
    ctx,
    stats,
    sets,
    kinds,
    comboIds,
    mainEchoBuffs,
    mainIndex,
    echoes,
  )
}

export function buildEvaluationFeatureBreakdownFromEncoded(
  ctx: SuggestContext,
  stats: Float32Array,
  sets: Uint8Array,
  kinds: Uint16Array,
  comboIds: Int32Array,
  mainEchoBuffs: Float32Array,
  mainIndex: number,
  echoes?: readonly EchoInstance[],
): EvaluationFeature[] {
  if (ctx.mode === 'rotation' && ctx.candidatePlan && echoes) {
    const details = evaluationRotationDetails(ctx, { echoes, sets, kinds, comboIds, mainIndex }, stats)
    // Echo skills can occur on several teammates with the same catalog ID.
    return details.features.map((feature) => ({ skillId: `${feature.resonatorId}:${feature.id}`, label: feature.label, tab: feature.tab,
      skillType: feature.skillType, resonatorId: feature.resonatorId, damage: feature.damage, weightedDamage: feature.damage,
      sharePct: details.total > 0 ? feature.damage / details.total * 100 : 0,
    })).sort((left, right) => right.weightedDamage - left.weightedDamage)
  }

  if (ctx.mode === 'target') {
    const damage = evalTarget({
      context: ctx.pckdCtx,
      stats,
      setConstLut: ctx.setConstLut,
      mainEchoBuffs,
      sets,
      kinds,
      comboIds,
      mainIndex,
    })?.damage ?? 0
    return [{
      skillId: ctx.skll.id,
      label: ctx.skll.label,
      tab: ctx.skll.tab,
      skillType: ctx.skll.skillType,
      damage,
      weightedDamage: damage,
      sharePct: 100,
    }]
  }

  const rows: EvaluationFeature[] = []
  for (let index = 0; index < ctx.contextCount; index += 1) {
    const skill = ctx.sklls[index]
    const context = ctx.contexts.subarray(index * ctx.contextStride, (index + 1) * ctx.contextStride)
    const damage = evalTarget({
      context,
      stats,
      setConstLut: ctx.setConstLut,
      mainEchoBuffs,
      sets,
      kinds,
      comboIds,
      mainIndex,
    })?.damage ?? 0
    const weight = ctx.contextWeight[index] ?? 1
    rows.push({
      skillId: skill.id,
      label: skill.label,
      tab: skill.tab,
      skillType: skill.skillType,
      damage,
      weightedDamage: damage * weight,
      sharePct: 0,
    })
  }

  const total = rows.reduce((sum, row) => sum + Math.max(0, row.weightedDamage), 0)
  return rows
    .map((row) => ({
      ...row,
      sharePct: total > 0 ? (Math.max(0, row.weightedDamage) / total) * 100 : 0,
    }))
    .sort((left, right) => right.weightedDamage - left.weightedDamage)
}
