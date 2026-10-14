/*
  Author: Runor Ewhro
  description: runs suggestions jobs inside a dedicated web worker and
               posts either successful results or structured errors back
               to the main thread.
*/

/// <reference lib="webworker" />

import { initGameData } from '@/data/gameData'
import type {
  SuggsWrkrDon,
  SuggsWrkrRrr,
  SuggsWrkrInM,
} from '@/engine/suggestions/types'

let suggsCorePrm: Promise<typeof import('@/engine/suggestions/core')> | null = null

function loadSuggsCor() {
  if (!suggsCorePrm) {
    suggsCorePrm = import('@/engine/suggestions/core')
  }

  return suggsCorePrm
}

self.onmessage = async (event: MessageEvent<SuggsWrkrInM>) => {
  const message = event.data
  const scope = self as DedicatedWorkerGlobalScope

  try {
    const input = message.type === 'compact'
      ? message.payload.input
      : message.type === 'weapons' ? message.payload : message.payload.scoringInput
    await initGameData({
      mode: message.gameDataMode,
      resonatorIds: message.type === 'compact'
        ? message.payload.resonatorIds
        : [input.runtime.id, ...Object.keys(input.runtimesById)],
      ...(message.type === 'compact' ? {
        calculationOnly: true,
        weaponIds: message.payload.weaponIds,
      } : {}),
    })
    const {
      runMainStats: mainRunner,
      runSetPlanqc: setRunner,
      runWpnSuggs: wpnRunner,
    } = await loadSuggsCor()
    const { mkPrepMainSt, mkPrepSetPla, mkPrepWpnSu } = await import('@/engine/suggestions/shared')

    const result = message.type === 'compact'
      ? (() => {
        const { input: compactInput, simulation, weapon } = message.payload
        if (message.mode === 'mainStats') {
          const prepared = mkPrepMainSt({ ...compactInput, setStateMode: 'resolved' }, simulation)
          return prepared ? mainRunner(prepared) : []
        }
        if (message.mode === 'setPlans') {
          const prepared = mkPrepSetPla({ ...compactInput, includeEchoAttacks: undefined }, simulation)
          return prepared ? setRunner(prepared).map((plan) => ({
            avgDamage: plan.avgDamage,
            setPlan: plan.setPlan,
            ...(plan.displayPlan ? { displayPlan: plan.displayPlan } : {}),
          })) : []
        }
        const prepared = mkPrepWpnSu({ ...compactInput, includeEchoAttacks: true, weapon, topK: 30 }, simulation)
        return prepared ? wpnRunner(prepared) : []
      })()
      : message.type === 'mainStats'
            ? mainRunner(message.payload)
            : message.type === 'setPlans'
                ? setRunner(message.payload)
                : wpnRunner(message.payload)

    const response: SuggsWrkrDon = {
      id: message.id,
      ok: true,
      result,
    }

    scope.postMessage(response)
  } catch (error) {
    const response: SuggsWrkrRrr = {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Suggestions worker failed unexpectedly',
    }

    scope.postMessage(response)
  }
}
