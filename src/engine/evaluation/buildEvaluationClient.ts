/*
  Author: Runor Ewhro
  description: browser-side client for dispatching build evaluation work to
               a dedicated worker.
*/

import type { EvaluationSummary } from './buildEvaluationWorkerTypes'
import type { ShowcaseAnalysisInput, ShowcaseAnalysisProgress, ShowcaseAnalysisResult } from './showcaseAnalysis'
import type {
  BuildEvaluationReport,
  EvaluationReportOpts,
  DefRotEvaluationIn,
} from '@/engine/evaluation/buildEvaluation'
import type {
  EvaluationWorkerIn,
  EvaluationWorkerOut,
} from '@/engine/evaluation/buildEvaluationWorkerTypes'
import { makeEvaluationKey } from '@/engine/evaluation/buildEvaluationKey'
import { getGameDataMode } from '@/data/gameData'
import { WorkerChannel } from '@/shared/lib/WorkerChannel'

type WorkerReq = EvaluationWorkerIn extends infer Job
  ? Job extends { id: number } ? Omit<Job, 'id'> : never
  : never

// retain a bounded set of recent reports for reuse when returning to a resonator.
const MAX_REPORT_CACHE = 3
type ProgressListener = (progress: ShowcaseAnalysisProgress) => void
type ShowcaseProgressState = {
  key: string
  listeners: Set<ProgressListener>
  damage?: Extract<ShowcaseAnalysisProgress, { stage: 'damage' }>
  score?: Extract<ShowcaseAnalysisProgress, { stage: 'score' }>
}

function canonicalReportOptions(options?: EvaluationReportOpts): EvaluationReportOpts {
  const sections = options?.sections
  return {
    alternativesLimit: options?.alternativesLimit ?? 12,
    sections: {
      rotationFeatures: sections?.rotationFeatures ?? true,
      upgradePaths: sections?.upgradePaths ?? true,
      echoStatsTable: sections?.echoStatsTable ?? true,
      evaluationTargets: sections?.evaluationTargets ?? true,
    },
  }
}

function reportSourceKey(sourceKey: string, options?: EvaluationReportOpts): string {
  return makeEvaluationKey({
    mode: getGameDataMode(),
    sourceKey,
    reportOptions: canonicalReportOptions(options),
  })
}

function touchCacheEntry<T>(cache: Map<string, T>, key: string, value: T, limit: number): T {
  if (cache.has(key)) {
    cache.delete(key)
  }
  cache.set(key, value)
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value
    if (!oldestKey) {
      break
    }
    cache.delete(oldestKey)
  }
  return value
}

function readCacheEntry<T>(cache: Map<string, T>, key: string): T | undefined {
  if (!cache.has(key)) {
    return undefined
  }
  const value = cache.get(key) as T
  cache.delete(key)
  cache.set(key, value)
  return value
}

function makeReportCancelFlag(): Int32Array | null {
  if (typeof SharedArrayBuffer === 'undefined') {
    return null
  }
  return new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
}

function reportJobMessage(
  payloadKey: string,
  payload: DefRotEvaluationIn,
  reportOptions: EvaluationReportOpts | undefined,
  cancelFlag: Int32Array | null,
): WorkerReq {
  return {
    key: payloadKey,
    type: 'report',
    payload,
    options: reportOptions,
    ...(cancelFlag ? { cancelBuf: cancelFlag.buffer as SharedArrayBuffer } : {}),
  }
}

/** manages evaluation transport, in-flight work, completed caches, and cancellation. */
export class EvaluationClient {
  private activeReportKey: string | null = null
  private activeReportCancel: Int32Array | null = null
  private activeReportToken: object | null = null
  private readonly inFlightJobs = new Map<string, Promise<unknown>>()
  private readonly reportCache = new Map<string, BuildEvaluationReport | null>()
  private readonly reportSourceKeys = new Map<string, string>()
  private scoreCache: { key: string; percent: number | null } | null = null
  private summaryCache: { key: string; result: EvaluationSummary | null } | null = null
  private showcaseCache: { key: string; result: ShowcaseAnalysisResult } | null = null
  private showcaseProgress: ShowcaseProgressState | null = null
  private readonly channel = new WorkerChannel<EvaluationWorkerIn, EvaluationWorkerOut>({
    createWorker: () => new Worker(new URL('@/engine/evaluation/buildEvaluation.worker.ts', import.meta.url), { type: 'module' }),
    idleMs: 1_200,
    errorMessage: 'Build evaluation worker failed unexpectedly',
    isProgress: (message) => 'progress' in message,
    onIdle: () => { this.activeReportKey = null },
  })

  peekReport(sourceKey: string, options?: EvaluationReportOpts): BuildEvaluationReport | null | undefined {
    const key = this.reportSourceKeys.get(reportSourceKey(sourceKey, options))
    return key ? this.reportCache.get(key) : undefined
  }

  cancelReport(): void {
    this.activeReportToken = null
    if (this.activeReportCancel) {
      Atomics.store(this.activeReportCancel, 0, 1)
      this.activeReportCancel = null
    }
    if (!this.activeReportKey) return
    this.inFlightJobs.delete(this.activeReportKey)
    this.activeReportKey = null
    this.channel.dispose(new Error('Evaluation cancelled'))
  }

  release(): void {
    this.cancelReport()
    this.channel.dispose(new Error('Evaluation surface closed'))
    this.inFlightJobs.clear()
  }

  private dispatchEvaluationJob(
    message: WorkerReq,
    progress?: (value: ShowcaseAnalysisProgress) => void,
  ): Promise<unknown> {
    if (typeof Worker === 'undefined') {
      return Promise.reject(new Error('Build evaluation worker is not available'))
    }
    return this.channel.request(
      (id) => ({ id, gameDataMode: getGameDataMode(), ...message }) as EvaluationWorkerIn,
      { onProgress: (reply) => { if ('progress' in reply) progress?.(reply.progress) } },
    ).then((reply) => {
      if ('progress' in reply) throw new Error('Unexpected evaluation progress reply')
      if (!reply.ok) throw new Error(reply.error)
      return reply.result
    })
  }

  private dispatchCachedEvaluationJob(
    key: string,
    message: WorkerReq,
    progress?: (value: ShowcaseAnalysisProgress) => void,
  ): Promise<unknown> {
    const inFlight = this.inFlightJobs.get(key)
    if (inFlight) {
      return inFlight
    }

    const job = this.dispatchEvaluationJob(message, progress)
      .finally(() => {
        if (this.inFlightJobs.get(key) === job) this.inFlightJobs.delete(key)
      })
    this.inFlightJobs.set(key, job)
    return job
  }

  runReport(
    payload: DefRotEvaluationIn,
    options: {
      force?: boolean
      reportOptions?: EvaluationReportOpts
      cacheResult?: boolean
      sourceKey?: string
    } = {},
  ): Promise<BuildEvaluationReport | null> {
    // canonicalize omitted and default section options to one cache entry.
    const canonicalOptions = canonicalReportOptions(options.reportOptions)
    const reportKey = makeEvaluationKey({
      mode: getGameDataMode(),
      payload,
      reportOptions: canonicalOptions,
    })
    const sourceKey = options.sourceKey ? reportSourceKey(options.sourceKey, canonicalOptions) : null
    const cacheResult = options.cacheResult !== false
    if (options.force) {
      this.reportCache.delete(reportKey)
    } else if (cacheResult) {
      const cached = readCacheEntry(this.reportCache, reportKey)
      if (cached !== undefined) {
        if (sourceKey) touchCacheEntry(this.reportSourceKeys, sourceKey, reportKey, MAX_REPORT_CACHE)
        return Promise.resolve(cached)
      }
    }

    const key = `report:${reportKey}`
    const running = this.inFlightJobs.get(key)
    if (running) return running as Promise<BuildEvaluationReport | null>
    if (this.activeReportKey && this.activeReportKey !== key) {
      this.cancelReport()
    }
    this.activeReportKey = key
    const token = this.activeReportToken = {}
    const cancelFlag = makeReportCancelFlag()
    this.activeReportCancel = cancelFlag
    return this.dispatchCachedEvaluationJob(key, reportJobMessage(
      reportKey,
      payload,
      options.reportOptions,
      cancelFlag,
    )).then((report) => {
      const result = report as BuildEvaluationReport | null
      if (cacheResult) {
        touchCacheEntry(this.reportCache, reportKey, result, MAX_REPORT_CACHE)
        if (sourceKey) touchCacheEntry(this.reportSourceKeys, sourceKey, reportKey, MAX_REPORT_CACHE)
      }
      return result
    }).finally(() => {
      if (this.activeReportToken === token) {
        this.activeReportKey = null
        this.activeReportCancel = null
        this.activeReportToken = null
      }
    })
  }

  runScore(payload: Omit<DefRotEvaluationIn, 'simulation'>): Promise<number | null> {
    const key = `score:${makeEvaluationKey({ mode: getGameDataMode(), payload })}`
    if (this.scoreCache?.key === key) return Promise.resolve(this.scoreCache.percent)
    const running = this.inFlightJobs.get(key)
    if (running) return running as Promise<number | null>
    if (this.activeReportKey && this.activeReportKey !== key) this.cancelReport()
    this.activeReportKey = key
    const token = this.activeReportToken = {}
    const cancelFlag = makeReportCancelFlag()
    this.activeReportCancel = cancelFlag
    return this.dispatchCachedEvaluationJob(key, {
      key, type: 'score', payload,
      ...(cancelFlag ? { cancelBuf: cancelFlag.buffer as SharedArrayBuffer } : {}),
    }).then((value) => {
      const percent = value as number | null
      if (!cancelFlag || !Atomics.load(cancelFlag, 0)) this.scoreCache = { key, percent }
      return percent
    }).finally(() => {
      if (this.activeReportToken === token) {
        this.activeReportKey = null
        this.activeReportCancel = null
        this.activeReportToken = null
      }
    })
  }

  runSummary(payload: Omit<DefRotEvaluationIn, 'simulation'>): Promise<EvaluationSummary | null> {
    const key = `summary:${makeEvaluationKey({ mode: getGameDataMode(), payload })}`
    if (this.summaryCache?.key === key) return Promise.resolve(this.summaryCache.result)
    const running = this.inFlightJobs.get(key)
    if (running) return running as Promise<EvaluationSummary | null>
    if (this.activeReportKey && this.activeReportKey !== key) this.cancelReport()
    this.activeReportKey = key
    const token = this.activeReportToken = {}
    const cancelFlag = makeReportCancelFlag()
    this.activeReportCancel = cancelFlag
    return this.dispatchCachedEvaluationJob(key, {
      key, type: 'summary', payload,
      ...(cancelFlag ? { cancelBuf: cancelFlag.buffer as SharedArrayBuffer } : {}),
    }).then((value) => {
      const result = value as EvaluationSummary | null
      if (!cancelFlag || !Atomics.load(cancelFlag, 0)) this.summaryCache = { key, result }
      return result
    }).finally(() => {
      if (this.activeReportToken === token) {
        this.activeReportKey = null
        this.activeReportCancel = null
        this.activeReportToken = null
      }
    })
  }

  // one compact result, independent from the full report cache.
  runShowcase(payload: ShowcaseAnalysisInput, onProgress?: ProgressListener): Promise<ShowcaseAnalysisResult> {
    const key = `showcase:${makeEvaluationKey({ mode: getGameDataMode(), payload })}`
    if (this.showcaseCache?.key === key) {
      onProgress?.({ stage: 'damage', userDamage: this.showcaseCache.result.userDamage })
      onProgress?.({ stage: 'score', percent: this.showcaseCache.result.percent })
      return Promise.resolve(this.showcaseCache.result)
    }
    const running = this.inFlightJobs.get(key)
    if (running) {
      if (onProgress && this.showcaseProgress?.key === key) {
        this.showcaseProgress.listeners.add(onProgress)
        if (this.showcaseProgress.damage) onProgress(this.showcaseProgress.damage)
        if (this.showcaseProgress.score) onProgress(this.showcaseProgress.score)
      }
      return running as Promise<ShowcaseAnalysisResult>
    }
    if (this.activeReportKey && this.activeReportKey !== key) this.cancelReport()
    this.activeReportKey = key
    const token = this.activeReportToken = {}
    const progress: ShowcaseProgressState = { key, listeners: new Set(onProgress ? [onProgress] : []) }
    this.showcaseProgress = progress
    const cancelFlag = makeReportCancelFlag()
    this.activeReportCancel = cancelFlag
    return this.dispatchCachedEvaluationJob(key, {
      key, type: 'showcase', payload,
      ...(cancelFlag ? { cancelBuf: cancelFlag.buffer as SharedArrayBuffer } : {}),
    }, (value) => {
      if (value.stage === 'damage') progress.damage = value
      else progress.score = value
      for (const listener of progress.listeners) listener(value)
    }).then((value) => {
      const result = value as ShowcaseAnalysisResult
      if (!cancelFlag || !Atomics.load(cancelFlag, 0)) this.showcaseCache = { key, result }
      return result
    }).finally(() => {
      progress.listeners.clear()
      if (this.showcaseProgress === progress) this.showcaseProgress = null
      if (this.activeReportToken === token) {
        this.activeReportKey = null
        this.activeReportCancel = null
        this.activeReportToken = null
      }
    })
  }
}

const evaluationClient = new EvaluationClient()

export function peekEvaluationReport(sourceKey: string, options?: EvaluationReportOpts): BuildEvaluationReport | null | undefined {
  return evaluationClient.peekReport(sourceKey, options)
}

export function cancelEvaluationReport(): void { evaluationClient.cancelReport() }
export function releaseEvaluationResources(): void { evaluationClient.release() }

export function runEvaluationReport(
  payload: DefRotEvaluationIn,
  options: { force?: boolean; reportOptions?: EvaluationReportOpts; cacheResult?: boolean; sourceKey?: string } = {},
): Promise<BuildEvaluationReport | null> {
  return evaluationClient.runReport(payload, options)
}

export function runEvaluationScore(payload: Omit<DefRotEvaluationIn, 'simulation'>): Promise<number | null> {
  return evaluationClient.runScore(payload)
}

export function runEvaluationSummary(payload: Omit<DefRotEvaluationIn, 'simulation'>): Promise<EvaluationSummary | null> {
  return evaluationClient.runSummary(payload)
}

export function runShowcaseAnalysis(payload: ShowcaseAnalysisInput, onProgress?: ProgressListener): Promise<ShowcaseAnalysisResult> {
  return evaluationClient.runShowcase(payload, onProgress)
}
