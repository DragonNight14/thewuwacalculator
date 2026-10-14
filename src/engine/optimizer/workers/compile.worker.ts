/*
  Author: Runor Ewhro
  description: worker that compiles optimizer payloads off the main thread,
               upgrades packed arrays to shared buffers when possible, and
               can also materialize compact result refs back into uid-based
               result entries.
*/

import { sharePayload, payloadTransfers } from './payloadBuffers'
/// <reference lib="webworker" />

import { hydrGameData, initGameData } from '@/data/gameData'
import { initEchoCat } from '@/data/gameData/catalog/echoes'
import { initEchoStts } from '@/data/gameData/catalog/echoStats'
import { initResCat, initResDtls } from '@/data/gameData/resonators/resonatorDataStore'
import { initWpnData } from '@/data/gameData/weapons/weaponDataStore'
import { initEchoSetD } from '@/data/gameData/echoSets/effects'
import type {
  OptStartPay,
} from '@/engine/optimizer/types.ts'
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
  listDynamicSetStateParts: typeof import('@/engine/optimizer/encode/sets.ts').listDynamicSetStateParts
  makeSetMask: typeof import('@/engine/optimizer/encode/sets.ts').makeSetMask
  buildSetRows: typeof import('@/engine/optimizer/encode/sets.ts').buildSetRows
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
      import('@/engine/optimizer/encode/sets.ts'),
    ]).then(([compiler, materialize, sets]) => ({
      cmplOptPay: compiler.compOptPay,
      compileBaseline: compiler.compileBaseline,
      matOptResults: materialize.matOptRsltsF,
      compactTheoryResults: materialize.compactTheoryResults,
      evalBaseline: materialize.evalPrepOptB,
      listDynamicSetStateParts: sets.listDynamicSetStateParts,
      makeSetMask: sets.makeSetMask,
      buildSetRows: sets.buildSetRows,
    }))
  }

  return optCompMdlsP
}

function hydrOptSttcD(
    snapshot: NonNullable<OptStartPay['staticData']>,
): void {
  hydrGameData(snapshot.gameDataReg)
  initResCat(Object.values(snapshot.resCatById))
  initResDtls(snapshot.resDtlsById)
  initWpnData(Object.values(snapshot.weaponsById))
  initEchoCat(Object.values(snapshot.echoCatById))
  initEchoSetD(snapshot.echoSetDefs)
  if (snapshot.echoStats) {
    initEchoStts(snapshot.echoStats)
  }
}

// main worker entrypoint:
// - "start" compiles a raw optimizer payload and returns the packed result
// - otherwise it materializes compact result refs back into user-facing results
self.onmessage = async (event: MessageEvent<OptCompInMsg>) => {
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
          hydrOptSttcD(message.payload.staticData)
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
        const baselinePayload = compiled.mode === 'targetSkill' || compiled.mode === 'rotation'
          ? (() => {
              const dynamicStateParts = modules.listDynamicSetStateParts(compiled.runtime)
              return {
                ...compiled,
                setRtMask: modules.makeSetMask(compiled.runtime, message.setConds, { dynamicStateParts }),
                setConstLut: modules.buildSetRows(compiled.runtime, message.setConds, { dynamicStateParts }),
              }
            })()
          : compiled
        const response: OptBaselineDoneM = {
          type: 'baselineDone',
          runId: message.runId,
          result: modules.evalBaseline(baselinePayload, message.mainIndex),
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
