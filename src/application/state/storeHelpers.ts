/*
  Author: Runor Ewhro
  description: collects app-store bootstrap and derived-state helpers for
               initial persistence loading and per-resonator suggestion state
               access.
*/

import type { SuggestState } from '@/domain/entities/suggestions'
import type { ResonatorId } from '@/domain/entities/runtime'
import {
  makeAppState,
  makeSuggest,
} from '@/engine/runtime/defaults'
import { loadPrssAppS } from '@/application/persistence/storage'
import type { HydratedAppState } from '@/domain/entities/appState'
import type { AppStore } from './store'

export function mkDefMkName(resName: string, xstnCnt: number): string {
  return `${resName} Build ${xstnCnt + 1}`
}

export function mkDefRotName(
  resName: string,
  xstnCnt: number,
): string {
  return `${resName} Rotation ${xstnCnt + 1}`
}

// gear is shared by every equipped-status surface. saved scenarios stay on disk.
export function mkNtlAppStt(): HydratedAppState {
  if (typeof window === 'undefined') return makeAppState()
  return loadPrssAppS({ includeInventory: 'gear' }) ?? makeAppState()
}

export function getSuggsSttF(
  state: AppStore,
  resonatorId: ResonatorId,
): SuggestState {
  // callers often mutate suggestion state locally before writing back, so hand
  // them a clone, preserving the store reference.
  return state.simulation.suggestionsByResonatorId[resonatorId]
    ? structuredClone(state.simulation.suggestionsByResonatorId[resonatorId])
    : makeSuggest()
}
