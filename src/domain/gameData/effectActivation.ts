/*
  Author: Runor Ewhro
  Description: Classifies authored effects by the state needed to decide their
               activation. Build-bound effects are safe to include in static
               build displays; combat and active-target effects are not.
*/

import type {
  CondExpr,
  EffectDef,
  EvalScpRoot,
  FormExpr,
  SrcOwnDef,
} from '@/domain/gameData/contracts.ts'

export type EffectActivation =
    | 'passive'
    | 'buildConditional'
    | 'combatConditional'
    | 'activeTargeted'

type ActivationDependency = Exclude<EffectActivation, 'passive'>

interface ScopedPath {
  from: EvalScpRoot
  path: string
}

function normalizeScopedPath(path: string, from?: EvalScpRoot): ScopedPath {
  if (from) return { from, path }

  const roots: Array<[prefix: string, root: EvalScpRoot]> = [
    ['sourceRuntime.', 'sourceRuntime'],
    ['sourceFinalStats.', 'sourceFinalStats'],
    ['targetRuntime.', 'targetRuntime'],
    ['activeRuntime.', 'activeRuntime'],
    ['baseStats.', 'baseStats'],
    ['finalStats.', 'finalStats'],
    ['context.pool.', 'pool'],
    ['pool.', 'pool'],
    ['context.', 'context'],
    ['runtime.', 'sourceRuntime'],
  ]

  for (const [prefix, root] of roots) {
    if (path.startsWith(prefix)) {
      return { from: root, path: path.slice(prefix.length) }
    }
  }

  return { from: 'context', path }
}

function classifyPath(path: string, from?: EvalScpRoot): ActivationDependency {
  const normalized = normalizeScopedPath(path, from)

  if (normalized.from === 'activeRuntime') return 'activeTargeted'

  if (normalized.from === 'sourceRuntime' || normalized.from === 'targetRuntime') {
    return normalized.path.startsWith('base.') || normalized.path.startsWith('build.')
      ? 'buildConditional'
      : 'combatConditional'
  }

  if (
    normalized.from === 'sourceFinalStats'
    || normalized.from === 'baseStats'
    || normalized.from === 'finalStats'
    || normalized.from === 'pool'
  ) {
    return 'buildConditional'
  }

  if (
    normalized.path === 'echoSetCounts'
    || normalized.path.startsWith('echoSetCounts.')
    || normalized.path === 'team'
    || normalized.path.startsWith('team.')
  ) {
    return 'buildConditional'
  }

  if (
    normalized.path === 'activeResonatorId'
    || normalized.path.startsWith('activeResonatorId.')
    || normalized.path === 'selectedTargetsByOwnerKey'
    || normalized.path.startsWith('selectedTargetsByOwnerKey.')
  ) {
    return 'activeTargeted'
  }

  // Unknown context values are deliberately treated as combat state. This is
  // conservative: new runtime/enemy inputs cannot silently enter Build stats.
  return 'combatConditional'
}

function strongestDependency(
    current: ActivationDependency | null,
    next: ActivationDependency,
): ActivationDependency {
  if (current === 'activeTargeted' || next === 'activeTargeted') return 'activeTargeted'
  if (current === 'combatConditional' || next === 'combatConditional') return 'combatConditional'
  return 'buildConditional'
}

function formDependency(formula: FormExpr): ActivationDependency | null {
  if (formula.type === 'const') return null
  if (formula.type === 'read' || formula.type === 'table') {
    return classifyPath(formula.path, formula.from)
  }
  if (formula.type === 'clamp') return formDependency(formula.value)

  let dependency: ActivationDependency | null = null
  for (const value of formula.values) {
    const child = formDependency(value)
    if (child) dependency = strongestDependency(dependency, child)
  }
  return dependency
}

function conditionDependency(condition: CondExpr): ActivationDependency | null {
  if (condition.type === 'always') return null
  if (condition.type === 'not') return conditionDependency(condition.value)
  if (condition.type === 'and' || condition.type === 'or') {
    let dependency: ActivationDependency | null = null
    for (const value of condition.values) {
      const child = conditionDependency(value)
      if (child) dependency = strongestDependency(dependency, child)
    }
    return dependency
  }
  return classifyPath(condition.path, condition.from)
}

/**
 * Classify how an effect's application is decided. `passive` and
 * `buildConditional` are stable for one concrete build; the evaluator still
 * decides whether a build condition (level, sequence, set count, etc.) passes.
 */
type EffectOwnerGates = Pick<SrcOwnDef, 'unlockWhen' | 'visibleWhen'>

export function classifyEffectActivation(
    effect: EffectDef,
    owner?: EffectOwnerGates,
): EffectActivation {
  if (effect.targetScope === 'active' || effect.targetScope === 'activeOther') {
    return 'activeTargeted'
  }

  let dependency: ActivationDependency | null = effect.condition
    ? conditionDependency(effect.condition)
    : null

  for (const gate of [owner?.unlockWhen, owner?.visibleWhen]) {
    if (!gate) continue
    const child = conditionDependency(gate)
    if (child) dependency = strongestDependency(dependency, child)
  }

  for (const operation of effect.operations) {
    if (operation.type === 'add_immunity') continue
    const child = formDependency(operation.value)
    if (child) dependency = strongestDependency(dependency, child)
  }

  if (dependency) return dependency
  return effect.condition && effect.condition.type !== 'always'
    ? 'buildConditional'
    : 'passive'
}

export function isBuildBoundEffect(effect: EffectDef, owner?: EffectOwnerGates): boolean {
  const activation = classifyEffectActivation(effect, owner)
  return activation === 'passive' || activation === 'buildConditional'
}
