/*
  Author: Runor Ewhro
  description: manages the optimizer worker pool, dispatches GPU/CPU jobs,
               tracks progress, handles cancellation, and merges partial
               search results into final optimizer output.
*/

import { theoryBufferPlan } from './theoryBudget'
import { mkPrgrTrck } from './progressTracker'
import { bchSzFr, mkThryXctPay, resTgtGpuJob, resTgtGpuCll } from './jobPreparation'
export { resTgtGpuJob, resTgtGpuCll } from './jobPreparation'
import { poolState, ensThryProds, stopThryProd, ensWrkrPool, runTgtWrkrJo, runTgtCpuBtc, runGpuBtc, rstOptWrkrPo, type PoolRunHooks } from './poolScheduler'
export { rstOptWrkrPo, cnclActOptWr } from './poolScheduler'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import {
  CPU_JOB_SIZE,
  TARGET_GPU_JOB,
  ROT_GPU_JOB,
  MIN_PAR_COMBOS,
  CPU_THEORY_JOB,
  GPU_THEORY_JOB,
  WORKER_COUNT,
} from '@/engine/optimizer/config/constants.ts'
import {countMainCombos} from '@/engine/optimizer/search/counting.ts'
import {OptResultSet} from '@/engine/optimizer/results/collector.ts'
import {gnrtTgtCpuCm} from '@/engine/optimizer/target/batches.ts'
import {gnrtThryCpuCm} from '@/engine/optimizer/target/theoryBatches.ts'
import {
  packTargetSkill,
  shrPckdTgtSk,
} from '@/engine/optimizer/payloads/targetPayload.ts'
import {
  packRotation,
  shrPckdRotXc,
} from '@/engine/optimizer/payloads/rotationPayload.ts'
import { runTgtSrchBt } from '@/engine/optimizer/search/targetCpu.ts'
import { runRotSrchBt } from '@/engine/optimizer/search/rotationCpu.ts'
import type {
  OptBckn,
  OptBagResult,
  OptRawResult,
  PckdOptXctnP,
  PrepOptPay,
  PrepRotRun,
  PrepTheoryRot,
  PrepTheoryTarget,
  PrepTargetSkill,
} from '@/engine/optimizer/types.ts'
import type {
  OptThryProdIn,
  OptThryProdOu,
} from '@/engine/optimizer/workers/messages.ts'
import {
  makeTargetGpu,
  mkTgtJobs,
} from '@/engine/optimizer/workers/targetGpu.ts'
import {logOptimizer} from '@/engine/optimizer/config/log.ts'

function hasShrdRryBf(): boolean {
  return typeof SharedArrayBuffer !== 'undefined'
}

// reject every queued job that has not been dispatched yet
function mergeResults(
    collector: OptResultSet,
    results: readonly OptBagResult[],
): void {
  for (const result of results) {
    collector.push(result)
  }
}

function isBagRslt(result: OptRawResult): result is OptBagResult {
  return !('ids' in result)
}

// drive the theory orchestrator without a producer worker. used only in
// environments where worker is unavailable (e.g. vitest in plain node).
async function runThryBtcInP(
    payload: PrepTheoryTarget | PrepTheoryRot,
    execution: PckdOptXctnP,
    effectResultMax: number,
    totalCombos: number,
    runId: number,
    progress: ReturnType<typeof mkPrgrTrck>,
    collector: OptResultSet,
    hooks: PoolRunHooks,
): Promise<void> {
  const effBatch = bchSzFr(CPU_THEORY_JOB, payload.lowMmryMode)
  const freeBtchBffr: Int32Array[] = []
  const iterator = gnrtThryCpuCm({
    payload,
    batchSize: effBatch,
    borrowBuffer: (length) => freeBtchBffr.pop() ?? new Int32Array(length),
  })
  let genCmbs = 0

  for (const batch of iterator) {
    const rmnnCmbs = totalCombos - genCmbs
    if (rmnnCmbs <= 0) {
      break
    }

    const comboCount = Math.min(batch.comboCount, rmnnCmbs)
    genCmbs += comboCount

    if (poolState.activeRunId !== runId || hooks.isCancelled?.()) {
      return
    }

    const results = execution.mode === 'rotation'
        ? await runRotSrchBt(
            execution,
            {
              combosBatch: batch.combos,
              comboCount,
              lockMainIdx: batch.lockMainIdx,
              jobResultLimit: effectResultMax,
            },
            {
              isCancelled: hooks.isCancelled,
              onProcessed: progress.applyPrgr,
            },
          )
        : await runTgtSrchBt(
            execution,
            {
              combosBatch: batch.combos,
              comboCount,
              lockMainIdx: batch.lockMainIdx,
              jobResultLimit: effectResultMax,
            },
            {
              isCancelled: hooks.isCancelled,
              onProcessed: progress.applyPrgr,
            },
          )

    mergeResults(collector, results)

    if (genCmbs >= totalCombos) {
      break
    }
  }
}

async function runThryBtcWr(
    payload: PrepTheoryTarget | PrepTheoryRot,
    backend: OptBckn,
    hooks: PoolRunHooks = {},
): Promise<OptBagResult[]> {
  const runT0 = performance.now()
  const totalCombos = payload.theoryTotal
  if (totalCombos <= 0) {
    return []
  }

  const lowMmryMode = payload.lowMmryMode
  const useGpu = backend === 'gpu' && typeof Worker !== 'undefined'
  const workerTarget = lowMmryMode
      ? 1
      : totalCombos < MIN_PAR_COMBOS
          ? 1
          : useGpu
            ? WORKER_COUNT.gpu
            : WORKER_COUNT.cpu
  const { batchSize: effBatch } = theoryBufferPlan(
    bchSzFr(useGpu ? GPU_THEORY_JOB : CPU_THEORY_JOB, lowMmryMode), 1, lowMmryMode,
  )
  const stmtJobs = Math.max(
      1,
      Math.ceil(totalCombos / Math.max(1, effBatch)),
  )
  const workerCount = typeof Worker === 'undefined'
      ? 0
      : Math.min(workerTarget, stmtJobs)
  if (workerCount > 0) {
    ensWrkrPool(workerCount)
  }

  const runId = poolState.nextRunId++
  poolState.activeRunId = runId
  logOptimizer('[optimizer:theory] run start', {
    runId,
    mode: payload.mode,
    totalCombos,
    theoryRows: payload.theoryRows.length,
    resultLimit: payload.resultsLimit,
    lowMemoryMode: lowMmryMode,
    workerTarget,
    workerCount,
    batchSize: effBatch,
    statedJobs: stmtJobs,
    backend: useGpu ? 'gpu' : 'cpu',
  })

  // totalCombos comes from prnThryRows -> cntThryEmt and is exact, so the
  // tracker can start in 'evaluating' from t=0. no discovery phase is needed.
  const progress = mkPrgrTrck(totalCombos, hooks.onProgress, 'evaluating')
  const effectResultMax = payload.resultsLimit
  const jobResultLimit = useGpu
      ? resTgtGpuJob(effectResultMax, payload.lowMmryMode)
      : effectResultMax
  const collector = new OptResultSet(effectResultMax, payload.lowMmryMode)
  const execution = mkThryXctPay(payload)
  poolState.actRunCtx = useGpu
      ? {
        kind: 'gpu',
        mode: payload.mode === 'theoryRotation' ? 'rotation' : 'target',
        payload: payload.mode === 'theoryRotation'
            ? packRotation(payload)
            : makeTargetGpu(payload),
      }
      : {
        kind: 'cpu',
        payload: execution.mode === 'rotation'
            ? shrPckdRotXc(execution)
            : shrPckdTgtSk(execution),
      }

  // detaches this run's listeners from the warm producer workers; set once the
  // producer path configures them. invoked in finally so the shared workers are
  // left clean regardless of how the run exits.
  let detachProducer: (() => void) | null = null
  let wakeRun: (() => void) | null = null
  const pendingBatches = new Set<Promise<void>>()

  // each producer has one batch credit; all producers fit the byte budget.
  const { producers: producerCount } = theoryBufferPlan(effBatch,
    useGpu && !lowMmryMode && totalCombos >= MIN_PAR_COMBOS ? Math.min(WORKER_COUNT.cpu, stmtJobs) : 1,
    lowMmryMode,
  )

  try {
    if (workerCount <= 0) {
      await runThryBtcInP(
          payload,
          execution,
          effectResultMax,
          totalCombos,
          runId,
          progress,
          collector,
          hooks,
      )
    } else {
      // reuse the warm producer workers across runs; their game-data hydration
      // persists. per-run message listeners are added/removed below so the
      // shared workers stay clean between runs.
      const producers = ensThryProds(producerCount)

      const rsblBtchLngt = effBatch * 5
      const inFlight = pendingBatches
      const maxInFlghJob = lowMmryMode ? 1 : Math.max(1, workerCount)
      const batchQueue: Array<{
        combos: Int32Array
        comboCount: number
        lockMainIdx: number
        src: Worker
      }> = []
      // number of producers still streaming; production is finished only when
      // every shard has reported done and the queue has drained.
      let producersRemaining = producers.length
      let producerError: Error | null = null
      let pendingResolve: (() => void) | null = null
      let genCmbs = 0
      let jobsSent = 0
      let jobsDone = 0
      let rsltsSeen = 0

      const wake = () => {
        const resolve = pendingResolve
        pendingResolve = null
        if (resolve) {
          resolve()
        }
      }

      wakeRun = poolState.wakeTheoryRun = wake

      // wire one producer's message/error listeners, tagging batches with their
      // source worker so returned reuse buffers go back to the right producer.
      const detachers: Array<() => void> = []
      for (const producer of producers) {
        const onMessage = (event: MessageEvent<OptThryProdOu>) => {
          const msg = event.data
          if (msg.runId !== runId) {
            return
          }

          if (msg.type === 'theoryBatch') {
            batchQueue.push({
              combos: msg.combos,
              comboCount: msg.comboCount,
              lockMainIdx: msg.lockMainIdx,
              src: producer,
            })
            wake()
            return
          }

          if (msg.type === 'theoryProducerDone') {
            producersRemaining -= 1
            wake()
            return
          }

          producerError = new Error(msg.message)
          wake()
        }

        const onError = (event: ErrorEvent) => {
          producerError = new Error(event.message || 'Theory producer worker failed unexpectedly')
          wake()
        }

        producer.addEventListener('message', onMessage)
        producer.addEventListener('error', onError)
        detachers.push(() => {
          producer.removeEventListener('message', onMessage)
          producer.removeEventListener('error', onError)
        })
      }

      detachProducer = () => {
        for (const detach of detachers) {
          detach()
        }
      }

      const cancelAllProducers = () => {
        const cancelMsg: OptThryProdIn = {
          type: 'cancelTheoryProducer',
          runId,
        }
        for (const producer of producers) {
          producer.postMessage(cancelMsg)
        }
      }

      producers.forEach((producer, index) => {
        const startMsg: OptThryProdIn = {
          type: 'startTheoryProducer',
          runId,
          payload: { theoryRows: payload.theoryRows, profs: payload.profs },
          echoSetDefs: ECHO_SET_DEFS,
          batchSize: effBatch,
          shard: { index, count: producers.length },
        }
        producer.postMessage(startMsg)
      })

      while (true) {
        if (poolState.activeRunId !== runId || hooks.isCancelled?.()) {
          cancelAllProducers()
          break
        }

        if (producerError) {
          throw producerError
        }

        if (batchQueue.length === 0) {
          if (producersRemaining <= 0) {
            break
          }
          await new Promise<void>((resolve) => {
            pendingResolve = resolve
          })
          continue
        }

        const batch = batchQueue.shift()!
        const rmnnCmbs = totalCombos - genCmbs
        if (rmnnCmbs <= 0) {
          // tell the producers we're done; drain their trailing messages.
          cancelAllProducers()
          break
        }

        const comboCount = Math.min(batch.comboCount, rmnnCmbs)
        genCmbs += comboCount
        jobsSent += 1

        const localProducer = batch.src
        const jobPromise = (useGpu ? runGpuBtc : runTgtCpuBtc)(
            runId,
            batch.combos,
            comboCount,
            batch.lockMainIdx,
            jobResultLimit,
            (delta) => {
              if (poolState.activeRunId !== runId) {
                return
              }
              progress.applyPrgr(delta)
            },
        )
            .then((done) => {
              if (poolState.activeRunId !== runId) {
                return
              }
              mergeResults(collector, done.results.filter(isBagRslt))
              if (useGpu) {
                progress.applyPrgr(comboCount)
              }
              jobsDone += 1
              rsltsSeen += done.results.length

              const buffer = done.rtrnCmbsBtch?.length === rsblBtchLngt
                ? done.rtrnCmbsBtch : undefined
              const returnMsg: OptThryProdIn = { type: 'returnTheoryBuffer', runId, buffer }
              localProducer.postMessage(returnMsg, buffer ? [buffer.buffer] : [])
            })
            .finally(() => {
              inFlight.delete(jobPromise)
              wake()
            })

        inFlight.add(jobPromise)

        if (inFlight.size >= maxInFlghJob) {
          await Promise.race(inFlight)
        }
      }

      await Promise.all(inFlight)

      logOptimizer('[optimizer:theory] dispatch done', {
        runId,
        generated: genCmbs,
        totalCombos,
        jobsSent,
        jobsDone,
        resultRefs: rsltsSeen,
        elapsedMs: Math.round(performance.now() - runT0),
      })
    }
  } catch (error) {
    logOptimizer('[optimizer:theory] run error', {
      runId,
      elapsedMs: Math.round(performance.now() - runT0),
      error: error instanceof Error ? error.message : String(error),
    })
    // defensively replace the producer on error when it may be in a bad state.
    if (poolState.activeRunId === runId) {
      stopThryProd()
      rstOptWrkrPo()
    }
    throw error
  } finally {
    // leave the producer warm; just detach this run's listeners. teardown of
    // the worker itself happens via rstOptWrkrPo / cnclActOptWr (incl. the
    // error path above, which already called rstOptWrkrPo).
    detachProducer?.()
    await Promise.allSettled(pendingBatches)
    if (poolState.wakeTheoryRun === wakeRun) poolState.wakeTheoryRun = null
    if (poolState.activeRunId === runId) {
      poolState.activeRunId = null
      progress.complete()
      poolState.actRunCtx = null
    }
  }

  const finalResults = collector.sorted()
  logOptimizer('[optimizer:theory] run complete', {
    runId,
    elapsedMs: Math.round(performance.now() - runT0),
    resultCount: finalResults.length,
  })
  return finalResults
}

// run a target-skill search on gpu workers using contiguous combo jobs
async function runTgtSkllGp(
    payload: PrepTargetSkill,
    hooks: PoolRunHooks = {},
): Promise<OptBagResult[]> {
  const totalCombos =
      payload.totalCombos *
      Math.max(1, payload.lockMainReq ? payload.lockMainCands.length : 1) *
      payload.progFact

  if (totalCombos <= 0) {
    return []
  }

  const jobs = mkTgtJobs(payload, TARGET_GPU_JOB)
  const workerCount = Math.min(WORKER_COUNT.gpu, Math.max(1, jobs.length))
  ensWrkrPool(workerCount)

  const runId = poolState.nextRunId++
  poolState.activeRunId = runId

  const progress = mkPrgrTrck(totalCombos, hooks.onProgress)
  const effectResultMax = payload.resultsLimit
  const cllcLmt = resTgtGpuCll(effectResultMax, payload.lowMmryMode)
  const collector = new OptResultSet(cllcLmt, payload.lowMmryMode)
  const jobResultLimit = resTgtGpuJob(effectResultMax, payload.lowMmryMode)

  // gpu workers bootstrap lazily inside their first real task. the run has
  // no separate ready handshake.
  poolState.actRunCtx = {
    kind: 'gpu',
    mode: 'target',
    payload: makeTargetGpu(payload),
  }

  try {
    for (const job of jobs) {
      if (poolState.activeRunId !== runId) {
        return collector.sorted()
      }

      const done = await runTgtWrkrJo(runId, job, jobResultLimit)

      if (poolState.activeRunId !== runId) {
        return collector.sorted()
      }

      mergeResults(collector, done.results.filter(isBagRslt))
      progress.applyPrgr(job.comboCount * payload.progFact)
    }
  } catch (error) {
    rstOptWrkrPo()
    throw error
  } finally {
    if (poolState.activeRunId === runId) {
      poolState.activeRunId = null
      progress.complete()
      poolState.actRunCtx = null
    }
  }

  return collector.sorted()
}

// run a rotation search on gpu workers using the same job model as target mode
async function runRotGpuWit(
    payload: PrepRotRun,
    hooks: PoolRunHooks = {},
): Promise<OptBagResult[]> {
  const totalCombos =
      payload.totalCombos *
      Math.max(1, payload.lockMainReq ? payload.lockMainCands.length : 1) *
      payload.progFact

  if (payload.contextCount <= 0 || totalCombos <= 0) {
    return []
  }

  const jobs = mkTgtJobs(payload, ROT_GPU_JOB)
  const workerCount = Math.min(WORKER_COUNT.gpu, Math.max(1, jobs.length))
  ensWrkrPool(workerCount)

  const runId = poolState.nextRunId++
  poolState.activeRunId = runId

  const progress = mkPrgrTrck(totalCombos, hooks.onProgress)
  const effectResultMax = payload.resultsLimit
  const cllcLmt = resTgtGpuCll(effectResultMax, payload.lowMmryMode)
  const collector = new OptResultSet(cllcLmt, payload.lowMmryMode)
  const jobResultLimit = resTgtGpuJob(effectResultMax, payload.lowMmryMode)

  // same lazy bootstrap path for rotation gpu workers.
  poolState.actRunCtx = {
    kind: 'gpu',
    mode: 'rotation',
    payload: packRotation(payload),
  }

  try {
    for (const job of jobs) {
      if (poolState.activeRunId !== runId) {
        return collector.sorted()
      }

      const done = await runTgtWrkrJo(runId, job, jobResultLimit)

      if (poolState.activeRunId !== runId) {
        return collector.sorted()
      }

      mergeResults(collector, done.results.filter(isBagRslt))
      progress.applyPrgr(job.comboCount * payload.progFact)
    }
  } catch (error) {
    rstOptWrkrPo()
    throw error
  } finally {
    if (poolState.activeRunId === runId) {
      poolState.activeRunId = null
      progress.complete()
      poolState.actRunCtx = null
    }
  }

  return collector.sorted()
}

// run a target-skill search on cpu workers using explicit combo batches
async function runTgtSkllCp(
    payload: PrepTargetSkill,
    hooks: PoolRunHooks = {},
): Promise<OptBagResult[]> {
  const totalCombos = countMainCombos(
      payload.costs,
      payload.lockMainCands,
  )

  if (totalCombos <= 0) {
    return []
  }

  // low-memory mode or tiny workloads avoid parallel overhead
  const lowMmryMode = payload.lowMmryMode
  const workerTarget = lowMmryMode
      ? 1
      : totalCombos < MIN_PAR_COMBOS
          ? 1
          : WORKER_COUNT.cpu

  const lckdMainNdcs = payload.lockMainReq
      ? payload.lockMainCands
      : [-1]

  const effBatch = bchSzFr(CPU_JOB_SIZE, lowMmryMode)
  const stmtJobs = lckdMainNdcs.length * Math.max(
      1,
      Math.ceil(totalCombos / Math.max(1, effBatch * payload.progFact)),
  )

  const workerCount = Math.min(workerTarget, Math.max(1, stmtJobs))
  const maxInFlghJob = lowMmryMode ? 1 : workerCount
  ensWrkrPool(workerCount)

  const runId = poolState.nextRunId++
  poolState.activeRunId = runId

  const progress = mkPrgrTrck(totalCombos, hooks.onProgress)
  const effectResultMax = payload.resultsLimit
  const collector = new OptResultSet(effectResultMax, payload.lowMmryMode)

  poolState.actRunCtx = {
    kind: 'cpu',
    payload: shrPckdTgtSk(packTargetSkill(payload)),
  }

  try {
    const inFlight = new Set<Promise<void>>()

    // each combo batch stores 5 indices per combination
    const rsblBtchLngt = effBatch * 5
    const freeBtchBffr: Int32Array[] = []

    for (const lockedMainIndex of lckdMainNdcs) {
      for (const batch of gnrtTgtCpuCm({
        costs: payload.costs,
        batchSize: effBatch,
        lockMainIdx: lockedMainIndex,
        borrowBuffer: (length) => freeBtchBffr.pop() ?? new Int32Array(length),
      })) {
        const jobPromise = runTgtCpuBtc(
            runId,
            batch.combos,
            batch.comboCount,
            lockedMainIndex,
            effectResultMax,
            (delta) => {
              if (poolState.activeRunId !== runId) {
                return
              }
              progress.applyPrgr(delta)
            },
        )
            .then((done) => {
              if (poolState.activeRunId !== runId) {
                return
              }

              mergeResults(collector, done.results.filter(isBagRslt))

              // recycle returned combo buffers when they match the standard reusable size
              if (done.rtrnCmbsBtch && done.rtrnCmbsBtch.length === rsblBtchLngt) {
                freeBtchBffr.push(done.rtrnCmbsBtch)
              }
            })
            .finally(() => {
              inFlight.delete(jobPromise)
            })

        inFlight.add(jobPromise)

        // limit in-flight work and the buffered jobs in large runs.
        if (inFlight.size >= maxInFlghJob) {
          await Promise.race(inFlight)
        }
      }
    }

    await Promise.all(inFlight)
  } catch (error) {
    rstOptWrkrPo()
    throw error
  } finally {
    if (poolState.activeRunId === runId) {
      poolState.activeRunId = null
      progress.complete()
      poolState.actRunCtx = null
    }
  }

  return collector.sorted()
}

// run a rotation search on cpu workers using the same batch system as target mode
async function runRotCpuWit(
    payload: PrepRotRun,
    hooks: PoolRunHooks = {},
): Promise<OptBagResult[]> {
  const totalCombos = countMainCombos(
      payload.costs,
      payload.lockMainCands,
  )

  if (payload.contextCount <= 0 || totalCombos <= 0) {
    return []
  }

  const lowMmryMode = payload.lowMmryMode
  const workerTarget = lowMmryMode
      ? 1
      : totalCombos < MIN_PAR_COMBOS
          ? 1
          : WORKER_COUNT.cpu

  const lckdMainNdcs = payload.lockMainReq
      ? payload.lockMainCands
      : [-1]

  const effBatch = bchSzFr(CPU_JOB_SIZE, lowMmryMode)
  const stmtJobs = lckdMainNdcs.length * Math.max(
      1,
      Math.ceil(totalCombos / Math.max(1, effBatch * payload.progFact)),
  )

  const workerCount = Math.min(workerTarget, Math.max(1, stmtJobs))
  const maxInFlghJob = lowMmryMode ? 1 : workerCount
  ensWrkrPool(workerCount)

  const runId = poolState.nextRunId++
  poolState.activeRunId = runId

  const progress = mkPrgrTrck(totalCombos, hooks.onProgress)
  const effectResultMax = payload.resultsLimit
  const collector = new OptResultSet(effectResultMax, payload.lowMmryMode)

  poolState.actRunCtx = {
    kind: 'cpu',
    payload: shrPckdRotXc(packRotation(payload)),
  }

  try {
    const inFlight = new Set<Promise<void>>()
    const rsblBtchLngt = effBatch * 5
    const freeBtchBffr: Int32Array[] = []

    for (const lockedMainIndex of lckdMainNdcs) {
      for (const batch of gnrtTgtCpuCm({
        costs: payload.costs,
        batchSize: effBatch,
        lockMainIdx: lockedMainIndex,
        borrowBuffer: (length) => freeBtchBffr.pop() ?? new Int32Array(length),
      })) {
        const jobPromise = runTgtCpuBtc(
            runId,
            batch.combos,
            batch.comboCount,
            lockedMainIndex,
            effectResultMax,
            (delta) => {
              if (poolState.activeRunId !== runId) {
                return
              }
              progress.applyPrgr(delta)
            },
        )
            .then((done) => {
              if (poolState.activeRunId !== runId) {
                return
              }

              mergeResults(collector, done.results.filter(isBagRslt))

              if (done.rtrnCmbsBtch && done.rtrnCmbsBtch.length === rsblBtchLngt) {
                freeBtchBffr.push(done.rtrnCmbsBtch)
              }
            })
            .finally(() => {
              inFlight.delete(jobPromise)
            })

        inFlight.add(jobPromise)

        if (inFlight.size >= maxInFlghJob) {
          await Promise.race(inFlight)
        }
      }
    }

    await Promise.all(inFlight)
  } catch (error) {
    rstOptWrkrPo()
    throw error
  } finally {
    if (poolState.activeRunId === runId) {
      poolState.activeRunId = null
      progress.complete()
      poolState.actRunCtx = null
    }
  }

  return collector.sorted()
}

// top-level pool entrypoint that resets the pool, then routes by mode and backend
export async function runOptWithWr(
    payload: PrepOptPay,
    backend: OptBckn,
    hooks: PoolRunHooks = {},
): Promise<OptRawResult[]> {
  logOptimizer('[optimizer:pool] run starting', {
    mode: payload.mode,
    backend,
    totalCombos: payload.totalCombos,
    resultsLimit: payload.resultsLimit,
    lowMemoryMode: payload.lowMmryMode,
    sharedArrayBufferAvailable: hasShrdRryBf(),
    lockedMainRequested: payload.lockMainReq,
    lockedMainCandidateCount: payload.lockMainCands.length,
    contextCount: 'contextCount' in payload ? payload.contextCount : undefined,
  })
  const guarded = poolState.beginRun(hooks)
  const t0 = performance.now()
  let results: OptRawResult[]
  if (payload.mode === 'theoryTarget' || payload.mode === 'theoryRotation') {
    results = await runThryBtcWr(payload, backend, guarded.hooks)
  } else if (payload.mode === 'rotation') {
    results = backend === 'gpu'
      ? await runRotGpuWit(payload, guarded.hooks)
      : await runRotCpuWit(payload, guarded.hooks)
  } else {
    results = backend === 'gpu'
      ? await runTgtSkllGp(payload, guarded.hooks)
      : await runTgtSkllCp(payload, guarded.hooks)
  }
  if (!guarded.isCurrent()) return []
  logOptimizer('[optimizer:pool] run complete', {
    mode: payload.mode,
    backend,
    resultCount: results.length,
    elapsedMs: Math.round(performance.now() - t0),
  })
  return results
}
