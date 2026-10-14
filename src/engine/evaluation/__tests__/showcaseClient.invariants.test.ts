/*
  Author: Runor Ewhro
  description: protects showcase evaluation cancellation, progress replay, cache
               reuse, and request replacement without a browser worker.
*/

import { afterEach, expect, it, vi } from 'vitest'
import type { ShowcaseAnalysisInput, ShowcaseAnalysisResult } from '../showcaseAnalysis'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('terminates superseded work without SharedArrayBuffer and keeps the replacement request active', async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.stubGlobal('SharedArrayBuffer', undefined)
  const workers: StubWorker[] = []
  class StubWorker {
    onmessage?: (event: { data: unknown }) => void
    terminate = vi.fn()
    postMessage = vi.fn()
    constructor() { workers.push(this) }
  }
  vi.stubGlobal('Worker', StubWorker)
  const { runShowcaseAnalysis, cancelEvaluationReport } = await import('../buildEvaluationClient')
  const payload = { scenarioId: 'test' } as ShowcaseAnalysisInput
  const first = runShowcaseAnalysis(payload)
  const cancelled = expect(first).rejects.toThrow('cancelled')
  cancelEvaluationReport()
  const readings = vi.fn()
  const replacement = runShowcaseAnalysis(payload, readings)
  await cancelled
  expect(workers[0].terminate).toHaveBeenCalledOnce()
  const staleMessage = workers[0].postMessage.mock.calls[0][0]
  workers[0].onmessage?.({ data: { id: staleMessage.id, progress: { stage: 'damage', userDamage: 999 } } })
  expect(readings).not.toHaveBeenCalled()
  const message = workers[1].postMessage.mock.calls[0][0]
  const damage = { stage: 'damage', userDamage: 123 }
  workers[1].onmessage?.({ data: { id: message.id, progress: damage } })
  expect(readings).toHaveBeenLastCalledWith(damage)
  vi.advanceTimersByTime(1200)
  expect(workers[1].terminate).not.toHaveBeenCalled()
  // the first request's finally must not delete a replacement with the same key.
  const lateReadings = vi.fn()
  const shared = runShowcaseAnalysis(payload, lateReadings)
  expect(lateReadings).toHaveBeenCalledExactlyOnceWith(damage)
  expect(workers).toHaveLength(2)
  expect(workers[1].postMessage).toHaveBeenCalledOnce()
  const result: ShowcaseAnalysisResult = { percent: 0.5, userDamage: 123, echoProfile: null }
  const score = { stage: 'score', percent: 0.5 }
  workers[1].onmessage?.({ data: { id: message.id, progress: score } })
  expect(readings).toHaveBeenLastCalledWith(score)
  expect(lateReadings).toHaveBeenLastCalledWith(score)
  workers[1].onmessage?.({ data: { id: message.id, ok: true, result } })
  expect(await replacement).toBe(result)
  expect(await shared).toBe(result)
  const cachedReadings = vi.fn()
  expect(await runShowcaseAnalysis(payload, cachedReadings)).toBe(result)
  expect(cachedReadings.mock.calls).toEqual([[damage], [score]])
  vi.advanceTimersByTime(1200)
  expect(workers[1].terminate).toHaveBeenCalledOnce()
})
