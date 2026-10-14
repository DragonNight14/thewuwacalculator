/*
  Author: Runor Ewhro
  description: manages optimizer worker requests, run tokens, payload transfers, compilation, and result materialization.
*/

import { payloadTransfers } from '@/engine/optimizer/workers/payloadBuffers'
import type {
  OptBckn,
  OptStoredResult,
  OptRawResult,
  OptStartPay,
  PrepOptPay,
} from '@/engine/optimizer/types'
import type { OptCompOutMs } from '@/engine/optimizer/compiler/compileWorker.types.ts'
import {
  CPU_JOB_SIZE,
  TARGET_GPU_JOB,
  ROT_GPU_JOB,
  CPU_THEORY_JOB,
  GPU_THEORY_JOB,
} from '@/engine/optimizer/config/constants'
import { errorOpt, logOptimizer } from '@/engine/optimizer/config/log.ts'

/** manages the store's compile worker and invalidates stale optimizer requests. */
export class OptimizerCompileSession {
  private runToken = 0
  private worker: Worker | null = null
  private readonly pending = new Map<Worker, Set<(error: Error) => void>>()

  begin(): number { return ++this.runToken }
  invalidate(): number { return ++this.runToken }
  isCurrent(token: number): boolean { return this.runToken === token }

  ensureWorker(): Worker {
    if (this.worker) return this.worker
    logOptimizer('[optimizer:store] spawning compile worker')
    this.worker = new Worker(new URL('@/engine/optimizer/workers/compile.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onerror = (event) => {
      errorOpt('[optimizer:store] compile worker uncaught error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      })
    }
    return this.worker
  }

  stop(): void {
    const worker = this.worker
    this.worker = null
    if (!worker) return
    for (const cancel of this.pending.get(worker) ?? []) cancel(new DOMException('Optimizer request cancelled', 'AbortError'))
    worker.terminate()
  }

  stopIfCurrent(worker: Worker): void {
    if (this.worker === worker) this.stop()
  }

  owns(worker: Worker): boolean { return this.worker === worker }

  async waitForResponse<T extends OptCompOutMs['type']>(
    worker: Worker,
    runId: number,
    expectedType: T,
    dispatch: () => void,
  ): Promise<Extract<OptCompOutMs, { type: T }>> {
    return await new Promise((resolve, reject) => {
      const pending = this.pending.get(worker) ?? new Set<(error: Error) => void>()
      this.pending.set(worker, pending)
      const cleanup = () => {
        worker.removeEventListener('message', onMsg)
        worker.removeEventListener('error', handleError)
        pending.delete(fail)
        if (!pending.size) this.pending.delete(worker)
      }
      const fail = (error: Error) => { cleanup(); reject(error) }
      const onMsg = (event: MessageEvent<OptCompOutMs>) => {
        const message = event.data
        if (message.runId !== runId) return
        cleanup()
        if (message.type === 'error') { reject(new Error(message.message)); return }
        if (message.type !== expectedType) {
          reject(new Error(`Unexpected optimizer compile worker response: ${message.type}`))
          return
        }
        resolve(message as Extract<OptCompOutMs, { type: T }>)
      }
      const handleError = (event: ErrorEvent) => fail(new Error(event.message || 'Optimizer compile worker failed unexpectedly'))
      worker.addEventListener('message', onMsg)
      worker.addEventListener('error', handleError)
      pending.add(fail)
      try { dispatch() } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
    })
  }
}

const compileSession = new OptimizerCompileSession()

export function bgnOptRun(): number {
  return compileSession.begin()
}

export function nvldOptRun(): number {
  return compileSession.invalidate()
}

export function isOptRunCur(runToken: number): boolean {
  return compileSession.isCurrent(runToken)
}

export function ensOptCompWr(): Worker {
  return compileSession.ensureWorker()
}

export function stopOptCompW(): void {
  compileSession.stop()
}

export function stopOptComhl(worker: Worker): void {
  compileSession.stopIfCurrent(worker)
}

export async function compOptPayIn(
  worker: Worker,
  runId: number,
  input: OptStartPay,
): Promise<PrepOptPay> {
  logOptimizer('[optimizer:store] dispatching compile job to worker', {
    runId,
    resonatorId: input.resonatorId,
    rotationMode: input.settings.rotationMode,
    inventorySize: input.invChs.length,
    hasStaticData: !!input.staticData,
  })

  const weaponDataIds = input.settings.includeWeapons
    ? (await import('@/engine/optimizer/context/weaponOverlays')).resolveWeaponCandidates(input)?.candidates.map((weapon) => weapon.id)
    : undefined
  if (!compileSession.owns(worker)) throw new DOMException('Optimizer request cancelled', 'AbortError')
  const t0 = performance.now()
  const message = await compileSession.waitForResponse(worker, runId, 'done', () => {
    worker.postMessage({
      type: 'start',
      runId,
      payload: weaponDataIds ? { ...input, weaponDataIds } : input,
    })
  })

  logOptimizer('[optimizer:store] compile worker responded', {
    runId,
    mode: message.payload.mode,
    comboTotalCombos: message.payload.totalCombos,
    comboN: message.payload.comboN,
    comboK: message.payload.comboK,
    contextCount: 'contextCount' in message.payload ? message.payload.contextCount : undefined,
    elapsedMs: Math.round(performance.now() - t0),
  })

  return message.payload
}

export async function matOptRsltsI(
  worker: Worker,
  runId: number,
  payload: PrepOptPay,
  results: OptRawResult[],
  uidByIndex: string[],
  limit: number,
): Promise<OptStoredResult[]> {
  logOptimizer('[optimizer:store] dispatching materialize job to worker', {
    runId,
    resultCount: results.length,
    limit,
    mode: payload.mode,
  })

  const t0 = performance.now()
  const message = await compileSession.waitForResponse(worker, runId, 'materialized', () => {
    worker.postMessage({
      type: 'materialize',
      runId,
      payload,
      results,
      uidByIndex,
      limit,
    }, payloadTransfers(payload))
  })

  logOptimizer('[optimizer:store] materialize complete', {
    runId,
    finalizedCount: message.results.length,
    elapsedMs: Math.round(performance.now() - t0),
  })

  return message.results
}

export function inferOptBtch(input: OptStartPay): number | null {
  if (input.settings.searchMode === 'theory') {
    return input.settings.enableGpu
      ? GPU_THEORY_JOB
      : CPU_THEORY_JOB
  }

  // batch sizing follows the effective backend path because rotation gpu,
  // target gpu, and cpu runs have different practical combo windows.
  if (input.settings.rotationMode) {
    return input.settings.enableGpu
      ? ROT_GPU_JOB
      : CPU_JOB_SIZE
  }

  return input.settings.enableGpu
    ? TARGET_GPU_JOB
    : CPU_JOB_SIZE
}

export function resOptBtchSi(backend: OptBckn): number | null {
  return backend === 'gpu'
    ? TARGET_GPU_JOB
    : CPU_JOB_SIZE
}
