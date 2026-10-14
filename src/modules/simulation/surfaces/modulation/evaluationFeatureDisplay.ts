/*
  Author: Runor Ewhro
  description: shared labels, colors, and grouping for evaluation rotation features.
*/

import type { EvaluationFeature } from '@/engine/evaluation/buildEvaluation.ts'
import { getSkillTabLabel } from '@/modules/simulation/model/skillTabs'
import { toTitle } from '@/shared/lib/format'

export const ROTATION_CHART_COLORS = [
  '#5ad1c4',
  '#f0a35e',
  '#7c9cf0',
  '#e07ab0',
  '#9bd45e',
  '#d6c25a',
  '#6ad0f0',
  '#c98cf0',
  '#e06d6d',
  '#8fb0c4',
]

export function getEvaluationFeatureTabLabel(tab: string, fallback?: string): string {
  const sharedLabel = getSkillTabLabel(tab)
  if (sharedLabel !== tab) return sharedLabel
  if (fallback && fallback !== tab) return fallback
  return toTitle(tab || 'feature')
}

export function groupRotationFeatureRows(rows: EvaluationFeature[]): EvaluationFeature[] {
  const bySkillId = new Map<string, EvaluationFeature>()

  for (const row of rows) {
    const existing = bySkillId.get(row.skillId)
    if (existing) {
      existing.weightedDamage += row.weightedDamage
      existing.damage = existing.weightedDamage
      continue
    }

    bySkillId.set(row.skillId, {
      ...row,
      damage: row.weightedDamage,
      sharePct: 0,
    })
  }

  const grouped = [...bySkillId.values()]
  const total = grouped.reduce((sum, row) => sum + Math.max(0, row.weightedDamage), 0)

  return grouped
    .map((row) => ({
      ...row,
      sharePct: total > 0 ? (Math.max(0, row.weightedDamage) / total) * 100 : 0,
    }))
    .sort((a, b) => b.weightedDamage - a.weightedDamage)
}
