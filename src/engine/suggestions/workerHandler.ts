/*
  Author: Runor Ewhro
  description: runs suggestion jobs inside a dedicated web worker and
               posts either successful results or structured errors back
               to the main thread.
*/

/// <reference lib="webworker" />

import { initGameData } from '@/data/gameData'
import type {
  SuggsWrkrDon,
  SuggsWrkrRrr,
  SuggsWrkrInM,
  SuggestContext,
  SuggestionWorkerDiagnostics,
} from '@/engine/suggestions/types'

let suggsCorePrm: Promise<typeof import('@/engine/suggestions/core')> | null = null

function loadSuggsCor() {
  if (!suggsCorePrm) {
    suggsCorePrm = import('@/engine/suggestions/core')
  }

  return suggsCorePrm
}

export async function handleMessage(event: MessageEvent<SuggsWrkrInM>) {
  const message = event.data
  const scope = self as DedicatedWorkerGlobalScope
  const receivedAt = performance.now()
  const diagnostics: SuggestionWorkerDiagnostics = {
    phase: 'gameData', coldModules: suggsCorePrm === null,
    timings: { gameDataMs: 0, modulesMs: 0, preparationMs: 0, searchMs: 0, packagingMs: 0, totalMs: 0 },
  }
  const measure = <T>(phase: 'preparation' | 'search' | 'packaging', operation: () => T): T => {
    diagnostics.phase = phase
    const startedAt = performance.now()
    try { return operation() } finally { diagnostics.timings[`${phase}Ms`] += performance.now() - startedAt }
  }
  const describe = (context: SuggestContext) => {
    scoringContext = context
    const plan = context.mode === 'rotation' ? context.teamDamagePlan : undefined
    diagnostics.prepared = {
      scoringMode: context.mode,
      targetContexts: context.mode === 'rotation' ? context.contextCount : 1,
      fixedTeamDamage: context.mode === 'rotation' ? context.fixedTeamDamage : 0,
      teammateDamageEvents: plan?.eventKeys.length ?? 0,
      allowedRotationFeatures: plan?.featureKeys.length ?? 0,
      sourceStatsAffectTeam: plan?.sourceStatsAffectTeam ?? false,
      statSensitiveSets: plan?.statSensitiveSets ?? [],
      statSensitiveEchoIds: plan?.statSensitiveEchoIds ?? [],
    }
  }
  let scoringContext: SuggestContext | undefined

  try {
    const input = message.type === 'compact'
      ? message.payload.input
      : message.type === 'weapons' ? message.payload : message.payload.scoringInput
    const dataStartedAt = performance.now()
    try {
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
    } finally { diagnostics.timings.gameDataMs = performance.now() - dataStartedAt }
    diagnostics.phase = 'modules'
    const modulesStartedAt = performance.now()
    let runners: Awaited<ReturnType<typeof loadSuggsCor>>
    let shared: typeof import('@/engine/suggestions/shared')
    try {
      runners = await loadSuggsCor()
      shared = await import('@/engine/suggestions/shared')
    } finally { diagnostics.timings.modulesMs = performance.now() - modulesStartedAt }
    const {
      runMainStats: mainRunner,
      runSetPlanqc: setRunner,
      runWpnSuggs: wpnRunner,
    } = runners
    const { mkPrepMainSt, mkPrepSetPla, mkPrepWpnSu } = shared
    if (message.type !== 'compact') describe(message.payload.context)

    const result = message.type === 'compact'
      ? await (async () => {
        const { input: compactInput, simulation, weapon } = message.payload
        if (message.mode === 'mainStats') {
          const prepared = measure('preparation', () => mkPrepMainSt({ ...compactInput, setStateMode: 'resolved' }, simulation))
          if (!prepared) return []
          describe(prepared.context)
          return measure('search', () => mainRunner(prepared))
        }
        if (message.mode === 'setPlans') {
          const prepared = measure('preparation', () => mkPrepSetPla({ ...compactInput, includeEchoAttacks: undefined }, simulation))
          if (!prepared) return { baseDamage: 0, results: [] }
          describe(prepared.context)
          const searchStartedAt = performance.now()
          diagnostics.phase = 'search'
          let scored: ReturnType<typeof setRunner>
          try {
            const { precomputeNeutralSetScores } = await import('./parallel')
            diagnostics.parallel = await precomputeNeutralSetScores(prepared, {
              mode: message.gameDataMode,
              resonatorIds: message.payload.resonatorIds,
              weaponIds: message.payload.weaponIds,
            })
            scored = setRunner(prepared)
          } finally { diagnostics.timings.searchMs += performance.now() - searchStartedAt }
          return measure('packaging', () => ({
            baseDamage: scored.baseAvg,
            results: scored.results.map((plan) => ({
              avgDamage: plan.avgDamage,
              setPlan: plan.setPlan,
              ...(plan.displayPlan ? { displayPlan: plan.displayPlan } : {}),
              ...(plan.mainEchoId ? { mainEchoId: plan.mainEchoId } : {}),
              ...(plan.mainEchoSetId != null ? { mainEchoSetId: plan.mainEchoSetId } : {}),
            })),
          }))
        }
        const prepared = measure('preparation', () => mkPrepWpnSu({ ...compactInput, includeEchoAttacks: true, weapon, topK: 30 }, simulation))
        if (!prepared) return []
        describe(prepared.context)
        return measure('search', () => wpnRunner(prepared))
      })()
      : message.type === 'mainStats'
            ? measure('search', () => mainRunner(message.payload))
            : message.type === 'setPlans'
                ? measure('search', () => setRunner(message.payload))
                : measure('search', () => wpnRunner(message.payload))

    diagnostics.phase = 'complete'
    if (scoringContext) diagnostics.scoring = shared.getSuggestionScoringDiagnostics(scoringContext)
    diagnostics.timings.totalMs = performance.now() - receivedAt

    const response: SuggsWrkrDon = {
      id: message.id,
      ok: true,
      result,
      diagnostics,
    }

    scope.postMessage(response)
  } catch (error) {
    diagnostics.timings.totalMs = performance.now() - receivedAt
    diagnostics.error = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: 'Error', message: String(error) }
    const response: SuggsWrkrRrr = {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Suggestions worker failed unexpectedly',
      diagnostics,
    }

    scope.postMessage(response)
  }
}
