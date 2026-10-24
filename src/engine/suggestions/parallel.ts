/*
  Author: Runor Ewhro
  description: precomputes independent suggestion candidates across bounded
               worker shards while leaving selection and ordering serial.
*/
import type { GameDataMode } from '@/domain/entities/gameDataMode'
import type { PrepSetPlanS, SuggestContext } from './types'
import { evalSuggChsW, getSuggestionScoringDiagnostics, retainSuggestionScores, type SuggestionScoreCandidate } from './shared'
import { countNeutralSetCandidates, iterateNeutralSetCandidates } from './setPlan/suggest'
import { SUGGESTION_WORKERS } from './config'
import { exportRotationCandidateCompilation, type RotationCandidateCompilation } from '@/engine/rotation/candidateScorer'

export interface CandidateBatchRequest {
  mode?: GameDataMode
  resonatorIds: string[]
  weaponIds: string[]
  context?: SuggestContext
  candidates: SuggestionScoreCandidate[]
  compiledRotation?: RotationCandidateCompilation
}
export type CandidateBatchResponse = {
  ok: true
  values: number[]
  initializationMs: number
  scoringMs: number
  diagnostics: ReturnType<typeof getSuggestionScoringDiagnostics>
} | { ok: false; error: string }

export interface ParallelSuggestionDiagnostics {
  workers: number
  candidates: number
  elapsedMs: number
  samplingMs: number
  estimatedRemainingMs: number
  decision: 'parallel' | 'serial-estimated-work'
  fallbackReason?: string
  shards: Array<Omit<Extract<CandidateBatchResponse, { ok: true }>, 'values'> & { worker: number; candidates: number }>
}

export async function precomputeNeutralSetScores(
  prepared: PrepSetPlanS,
  scope: Omit<CandidateBatchRequest, 'context' | 'candidates'>,
): Promise<ParallelSuggestionDiagnostics | null> {
  // small searches finish before another cold worker can repay its startup.
  const concurrency = typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency ?? 1
  if (typeof Worker === 'undefined' || concurrency < 4) return null
  const candidateCount = countNeutralSetCandidates(prepared)
  if (candidateCount < SUGGESTION_WORKERS.sampleCandidates) return null
  const started = performance.now()
  const iterator = iterateNeutralSetCandidates(prepared)
  const take = (limit: number) => {
    const batch: SuggestionScoreCandidate[] = []
    while (batch.length < limit) {
      const next = iterator.next()
      if (next.done) break
      batch.push(next.value)
    }
    return batch
  }
  const score = (candidate: SuggestionScoreCandidate) => evalSuggChsW(prepared.context,
    candidate.echoes, candidate.mainEchoBuffs, candidate.selfMainEchoEffects)
  const warmupCount = Math.min(SUGGESTION_WORKERS.sampleCandidates, Math.floor(candidateCount / 4))
  const sampleCount = Math.min(SUGGESTION_WORKERS.sampleCandidates, Math.floor(candidateCount / 4))
  for (const candidate of take(warmupCount)) score(candidate)
  const sampleStarted = performance.now()
  for (const candidate of take(sampleCount)) score(candidate)
  const samplingMs = performance.now() - sampleStarted
  const estimatedRemainingMs = samplingMs / sampleCount * (candidateCount - warmupCount - sampleCount)
  const diagnostics: ParallelSuggestionDiagnostics = {
    workers: 1, candidates: candidateCount, elapsedMs: performance.now() - started,
    samplingMs, estimatedRemainingMs, decision: 'serial-estimated-work', shards: [],
  }
  const startupMs = Math.max(0, sampleStarted - started - samplingMs * warmupCount / sampleCount)
  const workerCount = Math.min(SUGGESTION_WORKERS.maxWorkers, Math.floor(concurrency / 2))
  // suggestions pays startup once per shard. keep short cached scoring work
  // on this worker; optimizer backend selection has no bearing on this gate.
  if (estimatedRemainingMs <= SUGGESTION_WORKERS.minimumParallelMs
    || estimatedRemainingMs <= startupMs * workerCount * SUGGESTION_WORKERS.startupMargin) return diagnostics
  diagnostics.workers = workerCount
  diagnostics.decision = 'parallel'
  const compiledRotation = prepared.context.mode === 'rotation' && prepared.context.candidatePlan
    ? exportRotationCandidateCompilation(prepared.context.candidatePlan) : undefined
  const workers: Worker[] = []
  try {
    const remote = Array.from({ length: workerCount - 1 }, async (_, index) => {
      const worker = new Worker(new URL('./candidate.worker.ts', import.meta.url), { type: 'module' })
      workers.push(worker)
      let bootstrap = true
      let summary: ParallelSuggestionDiagnostics['shards'][number] | null = null
      while (true) {
        const batch = take(SUGGESTION_WORKERS.batchCandidates)
        if (!batch.length) break
        const response = await new Promise<Extract<CandidateBatchResponse, { ok: true }>>((resolve, reject) => {
          worker.onmessage = (event: MessageEvent<CandidateBatchResponse>) => {
            if (!event.data.ok) { reject(new Error(event.data.error)); return }
            if (event.data.values.length !== batch.length || event.data.values.some((value) => !Number.isFinite(value))) {
              reject(new Error('Invalid candidate shard response')); return
            }
            resolve(event.data)
          }
          worker.onerror = (event) => { event.preventDefault(); reject(new Error(event.message || 'Candidate worker failed')) }
          worker.onmessageerror = () => reject(new Error('Candidate worker response could not be decoded'))
          worker.postMessage({ ...scope, candidates: batch,
            ...(bootstrap ? { context: prepared.context, compiledRotation } : {}),
          } satisfies CandidateBatchRequest)
        })
        bootstrap = false
        retainSuggestionScores(prepared.context, batch, response.values)
        if (!summary) summary = { ok: true, worker: index + 1, candidates: 0, initializationMs: 0, scoringMs: 0, diagnostics: response.diagnostics }
        summary.candidates += batch.length
        summary.initializationMs += response.initializationMs
        summary.scoringMs += response.scoringMs
        summary.diagnostics = response.diagnostics
      }
      if (summary) diagnostics.shards.push(summary)
    })
    const settled = Promise.allSettled(remote)
    while (true) {
      const batch = take(SUGGESTION_WORKERS.batchCandidates)
      if (!batch.length) break
      for (const candidate of batch) score(candidate)
      // return messages release each remote worker's single batch credit.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    const results = await settled
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  } catch (error) {
    diagnostics.fallbackReason = error instanceof Error ? error.message : String(error)
  } finally {
    for (const worker of workers) worker.terminate()
    diagnostics.elapsedMs = performance.now() - started
  }
  return diagnostics
}
