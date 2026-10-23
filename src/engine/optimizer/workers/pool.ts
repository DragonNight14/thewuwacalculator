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
  ROT_GPU_JOB_TARGET_MS,
  MIN_PAR_COMBOS,
  CPU_THEORY_JOB,
  WORKER_COUNT,
} from '@/engine/optimizer/config/constants.ts'
import {countMainCombos} from '@/engine/optimizer/search/counting.ts'
import {OptResultSet} from '@/engine/optimizer/results/collector.ts'
import { theoryResultLegality } from '@/engine/optimizer/results/theoryEchoes.ts'
import {gnrtTgtCpuCm} from '@/engine/optimizer/target/batches.ts'
import { mkTgtCpuBound, mkTgtCpuOrder } from '@/engine/optimizer/target/cpuBound.ts'
import { composeWeaponContexts } from '@/engine/optimizer/target/cpu.ts'
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
import { adaptiveTheoryBatch, gpuPipelineDepth } from '../config/batching'
import { theoryBranchBound } from '@/engine/rotation/portable/bounds'
import { sharePayload } from '@/engine/search/layout/buffers'
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
  generateGpuJobs,
  costLegalTotals,
  type TgtJobSpec,
} from '@/engine/optimizer/workers/targetGpu.ts'
import { logOptimizer } from '@/engine/optimizer/config/log.ts'

function hasShrdRryBf(): boolean {
  return typeof SharedArrayBuffer !== 'undefined'
}

// reject every queued job that has not been dispatched yet
function mergeResults(
    collector: OptResultSet,
    results: readonly OptBagResult[],
    legal?: (result: OptBagResult) => boolean,
): void {
  for (const result of results) {
    if (!legal || legal(result)) collector.push(result)
  }
}

function isBagRslt(result: OptRawResult): result is OptBagResult {
  return !('ids' in result)
}

/** queue the following job before parent-side result handling, while the
 * worker's native scorer independently pipelines its GPU buffer slots. */
async function evaluateGpuJobs(jobs: Iterable<TgtJobSpec>, runId: number, limit: number, collector: OptResultSet,
  progress: ReturnType<typeof mkPrgrTrck>, factor: number, lowMemory: boolean, workerCount: number,
  adaptive?: ReturnType<typeof adaptiveTheoryBatch> | null,
): Promise<void> {
  const pending = new Set<Promise<void>>()
  try {
    for (const job of jobs) {
      if (poolState.activeRunId !== runId) break
      const task = runTgtWrkrJo(runId, job, limit).then((done) => {
        if (poolState.activeRunId !== runId) return
        mergeResults(collector, done.results.filter(isBagRslt))
        progress.applyPrgr(job.comboCount * factor)
        adaptive?.observe(job.comboCount, done.executionMs ?? 0)
      }).finally(() => pending.delete(task))
      pending.add(task)
      if (pending.size >= gpuPipelineDepth(lowMemory) * workerCount) await Promise.race(pending)
    }
    await Promise.all(pending)
  } catch (error) {
    rstOptWrkrPo()
    await Promise.allSettled(pending)
    throw error
  }
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
  const adaptive = adaptiveTheoryBatch(false, payload.lowMmryMode)
  const bound = execution.mode === 'rotation' ? theoryBranchBound({
    stats: execution.stats, sets: execution.sets,
    programs: execution.weaponPrograms?.length ? execution.weaponPrograms : [execution.rotationProgram],
  }) : null
  const legal = theoryResultLegality(payload)
  let cutoff = 0
  const iterator = gnrtThryCpuCm({
    payload,
    batchSize: effBatch,
    getBatchSize: adaptive ? () => adaptive.size : undefined,
    prune: bound ? (main, first, remaining) => bound(main, first, remaining, cutoff) : undefined,
    onPruned: progress.applyPrgr,
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

    const evaluatedAt = performance.now()
    const results = execution.mode === 'rotation'
        ? await runRotSrchBt(
            execution,
            {
              combosBatch: batch.combos,
              comboCount,
              lockMainIdx: batch.lockMainIdx,
              jobResultLimit: resTgtGpuCll(effectResultMax, payload.lowMmryMode),
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

    mergeResults(collector, results, legal)
    adaptive?.observe(comboCount, performance.now() - evaluatedAt)
    if (bound) { const ranked = collector.sorted(effectResultMax); cutoff = ranked.length >= effectResultMax ? ranked.at(-1)!.damage : 0 }

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
  const adaptive = adaptiveTheoryBatch(useGpu, lowMmryMode)
  const { batchSize: effBatch } = theoryBufferPlan(adaptive.size, 1, lowMmryMode, adaptive.max)
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
  // jobs keep spare results so builds the legality merge drops do not cost
  // a legal build its place
  const jobResultLimit = resTgtGpuCll(effectResultMax, payload.lowMmryMode)
  const collector = new OptResultSet(effectResultMax, payload.lowMmryMode)
  const legal = theoryResultLegality(payload)
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
    useGpu && !lowMmryMode && totalCombos >= MIN_PAR_COMBOS
      ? Math.min(WORKER_COUNT.cpu, stmtJobs) : Math.max(1, workerCount),
    lowMmryMode,
    adaptive?.max,
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

      const inFlight = pendingBatches
      const maxInFlghJob = useGpu ? gpuPipelineDepth(lowMmryMode) * workerCount : Math.max(1, workerCount)
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
      let prunedCombos = 0

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

          if (msg.type === 'theoryPruned') {
            prunedCombos += msg.count
            progress.applyPrgr(msg.count)
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

      const boundPayload = payload.mode === 'theoryRotation' && payload.rotationProgram ? sharePayload({
        stats: payload.stats, sets: payload.sets,
        weaponPrograms: payload.weaponPrograms?.length ? payload.weaponPrograms : [payload.rotationProgram],
      }) : null
      producers.forEach((producer, index) => {
        const startMsg: OptThryProdIn = {
          type: 'startTheoryProducer',
          runId,
          payload: { theoryRows: payload.theoryRows, profs: payload.profs },
          bounds: boundPayload ? {
            stats: boundPayload.stats, sets: boundPayload.sets,
            programs: boundPayload.weaponPrograms,
          } : undefined,
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
              mergeResults(collector, done.results.filter(isBagRslt), legal)
              if (useGpu) {
                progress.applyPrgr(comboCount)
              }
              jobsDone += 1
              rsltsSeen += done.results.length

              const buffer = done.rtrnCmbsBtch
              const ranked = collector.sorted(effectResultMax)
              const cutoff = ranked.length >= effectResultMax ? ranked.at(-1)!.damage : 0
              const nextBatchSize = adaptive?.observe(comboCount, done.executionMs ?? 0)
              const returnMsg: OptThryProdIn = { type: 'returnTheoryBuffer', runId, buffer, cutoff, nextBatchSize }
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
        prunedCombos,
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
  const legal = costLegalTotals(payload)
  const lockedMains = payload.lockMainReq ? Array.from(payload.lockMainCands) : [-1]
  const rawCombos = lockedMains.reduce((sum, index) => sum + (legal.get(index) ?? 0), 0)
  const totalCombos = rawCombos * payload.progFact

  if (totalCombos <= 0) {
    return []
  }

  const jobs = generateGpuJobs(payload, () => TARGET_GPU_JOB, lockedMains, (index) => legal.get(index) ?? 0)
  const workerCount = WORKER_COUNT.gpu
  ensWrkrPool(workerCount)

  const runId = poolState.nextRunId++
  poolState.activeRunId = runId

  const progress = mkPrgrTrck(totalCombos, hooks.onProgress)
  const effectResultMax = payload.resultsLimit
  const cllcLmt = resTgtGpuCll(effectResultMax, payload.lowMmryMode)
  const collector = new OptResultSet(cllcLmt, payload.lowMmryMode)
  const jobResultLimit = resTgtGpuJob(effectResultMax, payload.lowMmryMode)

  // gpu workers bootstrap lazily inside their first real task
  poolState.actRunCtx = {
    kind: 'gpu',
    mode: 'target',
    payload: makeTargetGpu(payload),
  }

  try {
    await evaluateGpuJobs(jobs, runId, jobResultLimit, collector, progress, payload.progFact, payload.lowMmryMode, workerCount, null)
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
  // generated kernels enumerate only cost-legal combos, so their job windows
  // and progress span that count per locked main
  const lockedMains = payload.lockMainReq ? Array.from(payload.lockMainCands) : [-1]
  const legal = costLegalTotals(payload)
  const totalCombos = lockedMains.reduce((sum, index) => sum + (legal.get(index) ?? 0), 0) * payload.progFact

  if (totalCombos <= 0) {
    return []
  }

  const adaptive = adaptiveTheoryBatch(true, payload.lowMmryMode, { max: ROT_GPU_JOB, targetMs: ROT_GPU_JOB_TARGET_MS })
  const jobs = generateGpuJobs(payload, () => adaptive.size, lockedMains, (index) => legal.get(index) ?? 0)
  const workerCount = WORKER_COUNT.gpu
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
    await evaluateGpuJobs(jobs, runId, jobResultLimit, collector, progress, payload.progFact, payload.lowMmryMode, workerCount, adaptive)
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

  const packed = packTargetSkill(payload)
  poolState.actRunCtx = {
    kind: 'cpu',
    payload: shrPckdTgtSk(packed),
  }

  // branch-and-bound against the run's k-th best so far. sorted() drops
  // superseded entries, so the floor names k distinct sets.
  const contexts = payload.weaponOverlays && (payload.weaponCount ?? 0) > 0
    ? composeWeaponContexts(packed.context, payload.weaponOverlays, payload.weaponCount!)
    : [packed.context]
  let floor = 0
  const raiseFloor = () => {
    const ranked = collector.sorted(effectResultMax)
    floor = ranked.length >= effectResultMax ? ranked.at(-1)!.damage : 0
  }

  try {
    const inFlight = new Set<Promise<void>>()

    // each combo batch stores 5 indices per combination
    const rsblBtchLngt = effBatch * 5
    const freeBtchBffr: Int32Array[] = []

    const boundInput = { contexts, stats: payload.stats, costs: payload.costs, sets: payload.sets,
      kinds: payload.kinds, mainEchoBuffs: payload.mainEchoBuffs, setConstLut: payload.setConstLut }
    const order = mkTgtCpuOrder(boundInput)
    for (const lockedMainIndex of lckdMainNdcs) {
      const bound = mkTgtCpuBound(boundInput, lockedMainIndex, order)
      for (const batch of gnrtTgtCpuCm({
        costs: payload.costs,
        batchSize: effBatch,
        lockMainIdx: lockedMainIndex,
        borrowBuffer: (length) => freeBtchBffr.pop() ?? new Int32Array(length),
        order,
        prune: (prefix, depth, costSum, after) => floor > 0 && bound(prefix, depth, costSum, after) < floor,
        onPruned: (count) => progress.applyPrgr(count * payload.progFact),
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
              raiseFloor()

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

  if (totalCombos <= 0) {
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
  })
  const guarded = poolState.beginRun(hooks)
  const t0 = performance.now()
  if (!guarded.isCurrent()) return []
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
  // beginRun already replaces these workers for the next search. release the
  // completed run's data and replay caches now instead of retaining idle heaps.
  poolState.reset(false)
  return results
}
