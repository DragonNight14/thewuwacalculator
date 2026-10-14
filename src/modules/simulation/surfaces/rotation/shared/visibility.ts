/*
  Author: Runor Ewhro
  description: keeps rotation authoring choices available when an earlier
               condition can change the state that controls their visibility.
*/

import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { SkillDef } from '@/domain/entities/stats'
import type { CondExpr } from '@/domain/gameData/contracts'
import { getNegFfctCm, isNegFfctVsb } from '@/engine/gameData/negativeEffects'
import { evalRuntimeSkillCondition } from '@/engine/pipeline/resolveSkill'

type ConditionEvaluator = (condition: CondExpr) => boolean

interface Possibility {
  yes: boolean
  no: boolean
}

function rotationWritable(condition: CondExpr): boolean {
  if (!('path' in condition)) return false
  if (condition.from && !['sourceRuntime', 'targetRuntime', 'activeRuntime'].includes(condition.from)) {
    return false
  }
  return condition.path.startsWith('state.controls.')
    || condition.path.startsWith('state.teamEffects.')
    || condition.path.startsWith('state.combat.')
}

function possibleValues(condition: CondExpr, evaluate: ConditionEvaluator): Possibility {
  if (condition.type === 'always') return { yes: true, no: false }
  if (condition.type === 'not') {
    const inner = possibleValues(condition.value, evaluate)
    return { yes: inner.no, no: inner.yes }
  }
  if (condition.type === 'and') {
    const values = condition.values.map((value) => possibleValues(value, evaluate))
    return { yes: values.every((value) => value.yes), no: values.some((value) => value.no) }
  }
  if (condition.type === 'or') {
    const values = condition.values.map((value) => possibleValues(value, evaluate))
    return { yes: values.some((value) => value.yes), no: values.every((value) => value.no) }
  }
  if (rotationWritable(condition)) return { yes: true, no: true }
  const value = evaluate(condition)
  return { yes: value, no: !value }
}

export function canRotationConditionMatch(
  condition: CondExpr | undefined,
  evaluate: ConditionEvaluator,
): boolean {
  return !condition || possibleValues(condition, evaluate).yes
}

function canUseNegativeEffect(
  runtime: ResRuntime,
  skill: SkillDef,
  runtimesById: Readonly<Record<string, ResRuntime>>,
): boolean {
  if (skill.tab !== 'negativeEffect') return true
  const key = getNegFfctCm(skill.archetype)
  if (!key || isNegFfctVsb(runtime, key, runtimesById)) return true

  const details = getResDtlsBy()
  return [runtime.id, ...runtime.build.team].some((id) => {
    if (!id) return false
    const sourceRuntime = id === runtime.id ? runtime : runtimesById[id]
    return Boolean(sourceRuntime && details[id]?.negativeEffectSources?.some((source) =>
      !('type' in source) && source.key === key && canRotationConditionMatch(
        source.enabledWhen,
        (condition) => evalRuntimeSkillCondition(sourceRuntime, condition),
      ),
    ))
  })
}

export function isRotationSkillVisible(
  runtime: ResRuntime,
  sourceSkill: SkillDef,
  runtimesById: Readonly<Record<string, ResRuntime>>,
): boolean {
  if (sourceSkill.visible === false) return false
  const evaluate = (condition: CondExpr) => evalRuntimeSkillCondition(runtime, condition)
  const variants = sourceSkill.skillVariantWhen ?? []
  const candidates = [
    {
      when: variants.length
        ? { type: 'not', value: { type: 'or', values: variants.map((variant) => variant.when) } } as CondExpr
        : undefined,
      skill: sourceSkill,
    },
    ...variants.map((variant, index) => ({
      when: index
        ? { type: 'and', values: [
          variant.when,
          ...variants.slice(0, index).map((prior) => ({ type: 'not', value: prior.when } as CondExpr)),
        ] } as CondExpr
        : variant.when,
      skill: { ...sourceSkill, ...variant.patch },
    })),
  ]

  return candidates.some(({ when, skill }) =>
    skill.visible !== false
      && canRotationConditionMatch(when, evaluate)
      && canRotationConditionMatch(skill.visibleWhen, evaluate)
      && canUseNegativeEffect(runtime, skill, runtimesById),
  )
}
