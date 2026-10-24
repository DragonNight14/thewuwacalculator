/*
  Author: Runor Ewhro
  description: compiles optimizer payloads in workers and materializes result references.
*/

import { sharePayload, payloadTransfers } from '@/engine/search/layout/buffers'
/// <reference lib="webworker" />

import { initGameData } from '@/data/gameData'
import { hydrateOptimizerGameData } from './gameData'
import type {
  OptCompDoneM,
  OptBaselineDoneM,
  OptCompRrrMs,
  OptCompInMsg,
  OptMatDoneMs,
} from '@/engine/optimizer/compiler/compileWorker.types.ts'
import { errorOpt, logOptimizer } from '@/engine/optimizer/config/log.ts'

let optCompMdlsP: Promise<{
  compileBaseline: typeof import('@/engine/optimizer/compiler').compileBaseline
  cmplOptPay: typeof import('@/engine/optimizer/compiler').compOptPay
  compactTheoryResults: typeof import('@/engine/optimizer/results/materialize.ts').compactTheoryResults
  matOptResults: typeof import('@/engine/optimizer/results/materialize.ts').matOptRsltsF
  evalBaseline: typeof import('@/engine/optimizer/results/materialize.ts').evalPrepOptB
}> | null = null

// the compile worker is now reused across runs, so game data only needs to be
// hydrated once. game data is static for the lifetime of the page, so caching
// this flag is safe and skips the repeated snapshot hydration cost on every
// subsequent run.
let gameDataReady = false

async function loadOptCompM() {
  if (!optCompMdlsP) {
    optCompMdlsP = Promise.all([
      import('@/engine/optimizer/compiler'),
      import('@/engine/optimizer/results/materialize.ts'),
    ]).then(([compiler, materialize]) => ({
      cmplOptPay: compiler.compOptPay,
      compileBaseline: compiler.compileBaseline,
      matOptResults: materialize.matOptRsltsF,
      compactTheoryResults: materialize.compactTheoryResults,
      evalBaseline: materialize.evalPrepOptB,
    }))
  }

  return optCompMdlsP
}

// main worker entrypoint:
// - "start" compiles a raw optimizer payload and returns the packed result
// - otherwise it materializes compact result refs back into user-facing results
export async function handleMessage(event: MessageEvent<OptCompInMsg>) {
  const message = event.data
  const scope = self as DedicatedWorkerGlobalScope

  logOptimizer('[optimizer:compile-worker] message received', {
    type: message.type,
    runId: message.runId,
    sharedArrayBufferAvailable: typeof SharedArrayBuffer !== 'undefined',
  })

  try {
    if (message.type === 'start' || message.type === 'baseline') {
      if (message.payload.staticData) {
        if (!gameDataReady) {
          logOptimizer('[optimizer:compile-worker] hydrating game data from static snapshot', {
            runId: message.runId,
          })
          hydrateOptimizerGameData(message.payload.staticData, message.payload.gameDataMode)
          logOptimizer('[optimizer:compile-worker] static data hydrated', { runId: message.runId })
        }
        gameDataReady = true
      } else {
        await initGameData({
          mode: message.payload.gameDataMode,
          calculationOnly: true,
          weaponIds: [message.payload.runtime, ...Object.values(message.payload.runtimesById ?? {})]
            .flatMap((runtime) => runtime.build.weapon.id ? [runtime.build.weapon.id] : [])
            .concat(message.payload.weaponDataIds ?? []),
          resonatorIds: [message.payload.runtime.id,
            ...Object.keys(message.payload.runtimesById ?? {})],
        })
        gameDataReady = true
      }

      logOptimizer('[optimizer:compile-worker] loading compiler modules', { runId: message.runId })
      const modules = await loadOptCompM()
      const { cmplOptPay: cmplPtmzPyld } = modules
      logOptimizer('[optimizer:compile-worker] compiler modules loaded', { runId: message.runId })

      logOptimizer('[optimizer:compile-worker] compiling payload', {
        runId: message.runId,
        rotationMode: message.payload.settings.rotationMode,
        inventorySize: message.payload.invChs.length,
      })

      const t0 = performance.now()
      const compiled = message.type === 'baseline'
        ? modules.compileBaseline(message.payload) : cmplPtmzPyld(message.payload)

      if (message.type === 'baseline') {
        const response: OptBaselineDoneM = {
          type: 'baselineDone',
          runId: message.runId,
          result: modules.evalBaseline(compiled, message.mainIndex),
        }
        scope.postMessage(response)
        return
      }

      logOptimizer('[optimizer:compile-worker] payload compiled, upgrading buffers', {
        runId: message.runId,
        mode: compiled.mode,
        totalCombos: compiled.totalCombos,
        contextCount: 'contextCount' in compiled ? compiled.contextCount : undefined,
        elapsedMs: Math.round(performance.now() - t0),
        willShareBuffers: typeof SharedArrayBuffer !== 'undefined',
      })

      // compile the raw payload, then upgrade eligible buffers to shared memory
      const payload = sharePayload(compiled)

      const trns = payloadTransfers(payload)
      logOptimizer('[optimizer:compile-worker] posting compiled payload', {
        runId: message.runId,
        transferableCount: trns.length,
      })

      const response: OptCompDoneM = {
        type: 'done',
        runId: message.runId,
        payload,
      }

      // regular ArrayBuffers transfer without copying large payloads.
      scope.postMessage(response, trns)
      return
    }

    // materialize result refs back into uid-based result entries
    logOptimizer('[optimizer:compile-worker] materializing results', {
      runId: message.runId,
      resultCount: message.results.length,
      limit: message.limit,
    })

    const t0 = performance.now()
    const { matOptResults: mtrlPtmzRslt, compactTheoryResults } = await loadOptCompM()
    const results = message.payload.mode === 'theoryTarget' || message.payload.mode === 'theoryRotation'
      ? compactTheoryResults(message.payload, message.results, message.limit)
      : mtrlPtmzRslt(
        message.uidByIndex,
        message.results,
        {
          payload: message.payload,
          limit: message.limit,
        },
    )

    logOptimizer('[optimizer:compile-worker] materialization complete', {
      runId: message.runId,
      finalizedCount: results.length,
      elapsedMs: Math.round(performance.now() - t0),
    })

    const response: OptMatDoneMs = {
      type: 'materialized',
      runId: message.runId,
      results,
    }

    scope.postMessage(response)
  } catch (error) {
    errorOpt('[optimizer:compile-worker] error', {
      runId: message.runId,
      type: message.type,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    const response: OptCompRrrMs = {
      type: 'error',
      runId: message.runId,
      message: error instanceof Error ? error.message : 'Failed to compile optimizer payload',
    }

    scope.postMessage(response)
  }
}
