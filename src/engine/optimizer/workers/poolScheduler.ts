/*
  Author: Runor Ewhro
  description: schedules cpu and gpu optimizer jobs across reusable workers,
               with run generations, timeouts, cancellation, and result merging.
*/

import { logOptimizer } from '@/engine/optimizer/config/log'
import type { OptPrgr, PckdOptXctnP, PckdRotXctnP } from '@/engine/optimizer/types'
import type { TargetGpuState, OptTaskDoneM, OptTaskInMsg, OptTaskOutMs } from './messages'
import type { TgtJobSpec } from './targetGpu'

const WORKER_TASK_MS = 300_000

export interface PoolRunHooks {
  isCancelled?: () => boolean
  onProgress?: (progress: OptPrgr) => void
}

type OptPoolGpuMode = 'target' | 'rotation'

interface TargetGpuJob {
  type: 'runTarget'
  runId: number
  size: number
  comboStart: number
  comboCount: number
  lockMainIdx: number
  jobResultLimit: number
  onProgress?: (delta: number) => void
  resolve: (message: OptTaskDoneM) => void
  reject: (error: Error) => void
}

interface TargetCpuJob {
  type: 'runTargetCpuBatch'
  runId: number
  size: number
  combosBatch: Int32Array
  comboCount: number
  lockMainIdx: number
  jobResultLimit: number
  onProgress?: (delta: number) => void
  resolve: (message: OptTaskDoneM) => void
  reject: (error: Error) => void
}

interface GpuBatchJob {
  type: 'runGpuBatch'
  runId: number
  size: number
  combosBatch: Int32Array
  comboCount: number
  lockMainIdx: number
  jobResultLimit: number
  onProgress?: (delta: number) => void
  resolve: (message: OptTaskDoneM) => void
  reject: (error: Error) => void
}

export type OptPoolJob =
    | TargetGpuJob
    | TargetCpuJob
    | GpuBatchJob

interface OptPoolCpuRu {
  kind: 'cpu'
  payload: PckdOptXctnP
}

interface OptPoolGpuRu {
  kind: 'gpu'
  mode: OptPoolGpuMode
  payload: TargetGpuState | PckdRotXctnP
}

type OptPoolRunCt =
    | OptPoolCpuRu
    | OptPoolGpuRu

// per-worker flags prevent retransmitting an unchanged cpu payload or gpu bootstrap.
export interface OptPoolWrkr {
  worker: Worker
  currentJob: OptPoolJob | null
  cpuPayLdd: boolean
  gpuBackend: OptPoolGpuMode | null
}

/** mutable resources shared by one optimizer worker pool across runs. */
export class OptimizerWorkerPool {
  workers: OptPoolWrkr[] = []
  queue: OptPoolJob[] = []
  nextRunId = 1
  activeRunId: number | null = null
  actRunCtx: OptPoolRunCt | null = null
  thryProducers: Worker[] = []
  wakeTheoryRun: (() => void) | null = null
  private generation = 0

  reset(invalidateRun = true): void {
    if (invalidateRun) this.generation += 1
    if (this.workers.length > 0 || this.queue.length > 0) {
      logOptimizer('[optimizer:pool] resetting worker pool', {
        workerCount: this.workers.length,
        queuedJobs: this.queue.length,
      })
    }
    const reason = new Error('Optimizer worker pool reset')
    rjctQdJobs(this, reason)
    for (const handle of this.workers) dspsWrkrOn(handle, reason)
    this.stopTheoryProducers()
    this.workers = []
    this.activeRunId = null
    this.actRunCtx = null
  }

  cancel(): void {
    if (this.activeRunId == null) return
    const runId = this.activeRunId
    logOptimizer('[optimizer:pool] cancelling active run', { runId, workerCount: this.workers.length })
    for (const handle of this.workers) {
      const message: OptTaskInMsg = { type: 'cancel', runId }
      handle.worker.postMessage(message)
    }
    this.activeRunId = null
    this.stopTheoryProducers()
    this.reset()
  }

  stopTheoryProducers(): void {
    this.wakeTheoryRun?.()
    this.wakeTheoryRun = null
    for (const producer of this.thryProducers) producer.terminate()
    this.thryProducers = []
  }

  ensureTheoryProducers(count: number): Worker[] {
    while (this.thryProducers.length < count) {
      this.thryProducers.push(new Worker(
        new URL('@/engine/optimizer/workers/theoryProducer.worker.ts', import.meta.url),
        { type: 'module' },
      ))
    }
    return this.thryProducers.slice(0, count)
  }

  ensureWorkers(count: number): OptPoolWrkr[] {
    if (this.workers.length === count) return this.workers
    logOptimizer('[optimizer:pool] creating worker pool', { count, previous: this.workers.length })
    this.reset(false)
    this.workers = Array.from({ length: count }, () => mkWrkrOn())
    return this.workers
  }

  enqueue(job: OptPoolJob): void {
    let index = 0
    while (index < this.queue.length && this.queue[index].size <= job.size) index += 1
    this.queue.splice(index, 0, job)
    schdQdJobs(this)
  }

  beginRun(hooks: PoolRunHooks): { hooks: PoolRunHooks; isCurrent: () => boolean } {
    this.reset()
    const generation = this.generation
    return {
      isCurrent: () => generation === this.generation,
      hooks: {
        isCancelled: () => generation !== this.generation || Boolean(hooks.isCancelled?.()),
        onProgress: (progress) => {
          if (generation === this.generation) hooks.onProgress?.(progress)
        },
      },
    }
  }
}

export const poolState = new OptimizerWorkerPool()

export function ensThryProds(count: number): Worker[] {
  return poolState.ensureTheoryProducers(count)
}

export function stopThryProd(): void {
  poolState.stopTheoryProducers()
}

function rjctQdJobs(pool: OptimizerWorkerPool, reason: Error): void {
  const pending = pool.queue
  pool.queue = []

  for (const job of pending) {
    job.reject(reason)
  }
}

function dspsWrkrOn(handle: OptPoolWrkr, reason: Error): void {
  if (handle.currentJob) {
    handle.currentJob.reject(reason)
  }

  handle.currentJob = null
  handle.cpuPayLdd = false
  handle.gpuBackend = null
  handle.worker.terminate()
}

function resWrkrJobMs(
    pool: OptimizerWorkerPool,
    handle: OptPoolWrkr,
    job: OptPoolJob,
): {
  message: OptTaskInMsg
  trns: Transferable[]
} {
  if (!pool.actRunCtx) {
    throw new Error('Optimizer worker run context is missing')
  }

  if (job.type === 'runTargetCpuBatch') {
    if (pool.actRunCtx.kind !== 'cpu') {
      throw new Error('CPU optimizer job was dispatched without a CPU run context')
    }

    const message: OptTaskInMsg = {
      type: 'runTargetCpuBatch',
      runId: job.runId,
      payload: handle.cpuPayLdd ? undefined : pool.actRunCtx.payload,
      combosBatch: job.combosBatch,
      comboCount: job.comboCount,
      lockMainIdx: job.lockMainIdx,
      jobResultLimit: job.jobResultLimit,
    }

    // the first cpu task seeds the worker; later tasks reuse that payload.
    handle.cpuPayLdd = true

    return {
      message,
      trns: [job.combosBatch.buffer],
    }
  }

  if (pool.actRunCtx.kind !== 'gpu') {
    throw new Error('GPU optimizer job was dispatched without a GPU run context')
  }

  if (pool.actRunCtx.mode === 'target') {
    if (job.type === 'runGpuBatch') {
      const message: OptTaskInMsg = {
        type: 'runTargetGpuBatch',
        runId: job.runId,
        combosBatch: job.combosBatch,
        comboCount: job.comboCount,
        lockMainIdx: job.lockMainIdx,
        jobResultLimit: job.jobResultLimit,
        btstPay: handle.gpuBackend === 'target'
          ? undefined
          : pool.actRunCtx.payload as TargetGpuState,
      }

      handle.gpuBackend = 'target'
      return { message, trns: [job.combosBatch.buffer] }
    }

    const message: OptTaskInMsg = {
      type: 'runTargetGpu',
      runId: job.runId,
      comboStart: job.comboStart,
      comboCount: job.comboCount,
      lockMainIdx: job.lockMainIdx,
      jobResultLimit: job.jobResultLimit,
      btstPay: handle.gpuBackend === 'target'
        ? undefined
        : pool.actRunCtx.payload as TargetGpuState,
    }

    // the first target task initializes the worker's gpu backend.
    handle.gpuBackend = 'target'
    return { message, trns: [] }
  }

  if (job.type === 'runGpuBatch') {
    const message: OptTaskInMsg = {
      type: 'runRotationGpuBatch',
      runId: job.runId,
      combosBatch: job.combosBatch,
      comboCount: job.comboCount,
      lockMainIdx: job.lockMainIdx,
      jobResultLimit: job.jobResultLimit,
      btstPay: handle.gpuBackend === 'rotation'
        ? undefined
        : pool.actRunCtx.payload as PckdRotXctnP,
    }

    handle.gpuBackend = 'rotation'
    return { message, trns: [job.combosBatch.buffer] }
  }

  const message: OptTaskInMsg = {
    type: 'runRotationGpu',
    runId: job.runId,
    comboStart: job.comboStart,
    comboCount: job.comboCount,
    lockMainIdx: job.lockMainIdx,
    jobResultLimit: job.jobResultLimit,
    btstPay: handle.gpuBackend === 'rotation'
      ? undefined
      : pool.actRunCtx.payload as PckdRotXctnP,
  }

  // the first rotation task initializes the worker's gpu backend.
  handle.gpuBackend = 'rotation'
  return { message, trns: [] }
}

/** request-scoped listeners isolate replies to their originating job. */
function dispWrkrJob(pool: OptimizerWorkerPool, handle: OptPoolWrkr, job: OptPoolJob): void {
  handle.currentJob = job

  let message: OptTaskInMsg
  let trns: Transferable[] = []

  try {
    const resolved = resWrkrJobMs(pool, handle, job)
    message = resolved.message
    trns = resolved.trns
  } catch (error) {
    handle.currentJob = null
    job.reject(error instanceof Error ? error : new Error(String(error)))
    schdQdJobs(pool)
    return
  }

  const worker = handle.worker
  const timeoutLabel = message.type
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const cleanup = () => {
    if (timeoutId != null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    worker.removeEventListener('message', onMessage)
    worker.removeEventListener('error', onError)
  }

  const fnshWithRrr = (error: Error) => {
    cleanup()
    if (handle.currentJob === job) {
      handle.currentJob = null
    }
    job.reject(error)
    schdQdJobs(pool)
  }

  const armTimeout = () => {
    if (timeoutId != null) {
      clearTimeout(timeoutId)
    }
    // progress rearms the deadline; complete silence terminates the request.
    timeoutId = setTimeout(() => {
      fnshWithRrr(new Error(`Optimizer worker task timed out: ${timeoutLabel}`))
    }, WORKER_TASK_MS)
  }

  const onMessage = (event: MessageEvent<OptTaskOutMs>) => {
    const wrkrMsg = event.data

    if (!wrkrMsg || wrkrMsg.runId !== job.runId) {
      return
    }

    if (wrkrMsg.type === 'progress') {
      job.onProgress?.(wrkrMsg.prcsDlt)
      armTimeout()
      return
    }

    cleanup()

    if (handle.currentJob === job) {
      handle.currentJob = null
    }

    if (wrkrMsg.type === 'error') {
      job.reject(new Error(wrkrMsg.message))
    } else {
      job.resolve(wrkrMsg)
    }

    schdQdJobs(pool)
  }

  const onError = (event: ErrorEvent) => {
    fnshWithRrr(new Error(event.message || 'Optimizer task worker failed unexpectedly'))
  }

  worker.addEventListener('message', onMessage)
  worker.addEventListener('error', onError)
  armTimeout()

  try {
    if (trns.length > 0) {
      worker.postMessage(message, trns)
    } else {
      worker.postMessage(message)
    }
  } catch (error) {
    fnshWithRrr(error instanceof Error ? error : new Error(String(error)))
  }
}

function schdQdJobs(pool: OptimizerWorkerPool): void {
  if (pool.queue.length === 0) {
    return
  }

  for (const handle of pool.workers) {
    if (handle.currentJob) {
      continue
    }

    const job = pool.queue.shift()
    if (!job) {
      return
    }

    dispWrkrJob(pool, handle, job)
  }
}

function mkWrkrOn(): OptPoolWrkr {
  const worker = new Worker(
      new URL('@/engine/optimizer/workers/task.worker.ts', import.meta.url),
      { type: 'module' },
  )

  return {
    worker,
    currentJob: null,
    cpuPayLdd: false,
    gpuBackend: null,
  }
}

export function ensWrkrPool(count: number): OptPoolWrkr[] {
  return poolState.ensureWorkers(count)
}

export function rstOptWrkrPo(): void {
  poolState.reset()
}

export function cnclActOptWr(): void {
  poolState.cancel()
}

function enqueueJob(job: OptPoolJob): void {
  poolState.enqueue(job)
}

export async function runTgtWrkrJo(
    runId: number,
    job: TgtJobSpec,
    jobResultLimit: number,
    onProgress?: (delta: number) => void,
): Promise<OptTaskDoneM> {
  return new Promise<OptTaskDoneM>((resolve, reject) => {
    enqueueJob({
      type: 'runTarget',
      runId,
      size: job.comboCount,
      comboStart: job.comboStart,
      comboCount: job.comboCount,
      lockMainIdx: job.lockMainIdx,
      jobResultLimit: jobResultLimit,
      onProgress,
      resolve,
      reject,
    })
  })
}

export async function runTgtCpuBtc(
    runId: number,
    combosBatch: Int32Array,
    comboCount: number,
    lockedMainIndex: number,
    jobResultLimit: number,
    onProgress?: (delta: number) => void,
): Promise<OptTaskDoneM> {
  return new Promise<OptTaskDoneM>((resolve, reject) => {
    enqueueJob({
      type: 'runTargetCpuBatch',
      runId,
      size: comboCount,
      combosBatch,
      comboCount,
      lockMainIdx: lockedMainIndex,
      jobResultLimit: jobResultLimit,
      onProgress,
      resolve,
      reject,
    })
  })
}

export async function runGpuBtc(
    runId: number,
    combosBatch: Int32Array,
    comboCount: number,
    lockedMainIndex: number,
    jobResultLimit: number,
    onProgress?: (delta: number) => void,
): Promise<OptTaskDoneM> {
  return new Promise<OptTaskDoneM>((resolve, reject) => {
    enqueueJob({
      type: 'runGpuBatch',
      runId,
      size: comboCount,
      combosBatch,
      comboCount,
      lockMainIdx: lockedMainIndex,
      jobResultLimit: jobResultLimit,
      onProgress,
      resolve,
      reject,
    })
  })
}
