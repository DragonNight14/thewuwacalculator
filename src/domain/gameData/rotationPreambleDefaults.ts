/*
  Author: Runor Ewhro
  description: resolves the canonical opening-state choices and default values
               used when authoring a rotation preamble.
*/

import type { SourceState } from './contracts.ts'
import {
  ACTIVE_RESONATOR_PATH,
  SELECTED_TARGET_PATH_PREFIX,
} from './rotationPaths.ts'

export interface PreambleChoice {
  resonatorId: string
  state: SourceState
}

/** the same state selection used by the editor's generate preamble action. */
export function openingConditionChoices<T extends PreambleChoice>(choices: readonly T[]): T[] {
  const seen = new Set<string>()
  return choices.filter((choice) => {
    const { path, ownerKey } = choice.state
    const key = `${choice.resonatorId}:${path}`
    if (path === ACTIVE_RESONATOR_PATH || path.startsWith(SELECTED_TARGET_PATH_PREFIX) ||
        ownerKey === 'rotation:formula' || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** default value chosen when the editor adds an opening condition. */
export function openingConditionValue(state: SourceState): string | number | boolean {
  if (state.defaultValue !== undefined) return state.defaultValue
  if (state.kind === 'toggle') return true
  if (state.kind === 'select') return state.options?.[0]?.id ?? ''
  return Math.max(state.min ?? 0, state.kind === 'stack' ? 1 : 0)
}
