/*
  Author: Runor Ewhro
  description: handles a short-lived suggestion scoring shard whose prepared
               context is scoped to one parent search job.
*/

/// <reference lib="webworker" />
import { initGameData } from '@/data/gameData'
import type { CandidateBatchRequest, CandidateBatchResponse } from './parallel'
import type { SuggestContext } from './types'

let preparedContext: SuggestContext | null = null

export async function handleMessage(event: MessageEvent<CandidateBatchRequest>) {
  const scope = self as DedicatedWorkerGlobalScope
  try {
    const { context, candidates, compiledRotation, ...data } = event.data
    const started = performance.now()
    if (context) {
      await initGameData({ ...data, calculationOnly: true })
      preparedContext = context
    }
    if (!preparedContext) throw new Error('Candidate worker has no prepared context')
    const { evalSuggChsW, getSuggestionScoringDiagnostics } = await import('./shared')
    if (preparedContext.mode === 'rotation' && preparedContext.candidatePlan && compiledRotation) {
      const { adoptRotationCandidateCompilation } = await import('@/engine/rotation/candidateScorer')
      adoptRotationCandidateCompilation(preparedContext.candidatePlan, compiledRotation)
    }
    const ready = performance.now()
    const active = preparedContext
    const values = candidates.map((candidate) => evalSuggChsW(active, candidate.echoes, candidate.mainEchoBuffs, candidate.selfMainEchoEffects))
    const response: CandidateBatchResponse = {
      ok: true, values, initializationMs: ready - started,
      scoringMs: performance.now() - ready, diagnostics: getSuggestionScoringDiagnostics(active),
    }
    scope.postMessage(response)
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies CandidateBatchResponse)
  }
}
