/*
  Author: Runor Ewhro
  description: applies immutable scenario replacement, identifier allocation,
               and selection updates to application state.
*/

import type { AppStore } from './store'
import { combatScenarioId, type CombatScenario, type CombatScenarioId } from '@/domain/entities/combatScenario'
import { replaceScenario, selectScenario, type ScenarioWorkspace } from '@/domain/entities/scenarioLibrary'

export function replaceScenarioInWorkspace(
  state: AppStore,
  scenarioId: CombatScenarioId,
  scenario: CombatScenario,
): AppStore {
  if (!state.combat.scenariosById[scenarioId] || scenario.id !== scenarioId) return state
  return {
    ...state,
    combat: replaceScenario(state.combat, scenario),
  }
}

export function nextScenarioId(
  combat: Pick<ScenarioWorkspace, 'scenariosById'>,
): CombatScenarioId {
  let id: CombatScenarioId
  do {
    const suffix = globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    id = combatScenarioId(`scenario:${suffix}`)
  } while (combat.scenariosById[id])
  return id
}

export function selectScenarioInState(
  state: AppStore,
  scenarioId: CombatScenarioId,
): AppStore {
  const combat = selectScenario(state.combat, scenarioId)
  return {
    ...state,
    combat,
  }
}
