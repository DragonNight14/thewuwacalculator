/*
  Author: Runor Ewhro
  description: a recent unchanged resonator report is available before the
               worker restarts or deferred simulation prepares its payload.
*/

import { afterEach, expect, it, vi } from 'vitest'
import type { DefRotEvaluationIn, BuildEvaluationReport } from '../buildEvaluation'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('reuses an exact A/B/A report after worker teardown without dispatching again', async () => {
  vi.resetModules()
  vi.useFakeTimers()
  const workers: StubWorker[] = []
  class StubWorker {
    onmessage?: (event: { data: unknown }) => void
    terminate = vi.fn()
    postMessage = vi.fn()
    constructor() { workers.push(this) }
  }
  vi.stubGlobal('Worker', StubWorker)
  const client = await import('../buildEvaluationClient')
  const payload = (id: string) => ({ scenarioId: id, runtime: { id } } as unknown as DefRotEvaluationIn)
  const first = { label: 'A' } as unknown as BuildEvaluationReport
  const second = { label: 'B' } as unknown as BuildEvaluationReport

  const a = client.runEvaluationReport(payload('A'), { sourceKey: 'source:A' })
  const aMessage = workers[0].postMessage.mock.calls[0][0]
  workers[0].onmessage?.({ data: { id: aMessage.id, ok: true, result: first } })
  expect(await a).toBe(first)

  const b = client.runEvaluationReport(payload('B'), { sourceKey: 'source:B' })
  const bMessage = workers[0].postMessage.mock.calls[1][0]
  workers[0].onmessage?.({ data: { id: bMessage.id, ok: true, result: second } })
  expect(await b).toBe(second)
  expect(client.peekEvaluationReport('source:A')).toBe(first)
  expect(client.peekEvaluationReport('source:B')).toBe(second)
  expect(client.peekEvaluationReport('source:A:edited')).toBeUndefined()
  expect(client.peekEvaluationReport('source:A', { alternativesLimit: 0 })).toBeUndefined()

  client.releaseEvaluationResources()
  expect(workers[0].terminate).toHaveBeenCalledOnce()
  expect(client.peekEvaluationReport('source:A')).toBe(first)
  expect(await client.runEvaluationReport(payload('A'), { sourceKey: 'source:A' })).toBe(first)
  expect(workers).toHaveLength(1)
  expect(workers[0].postMessage).toHaveBeenCalledTimes(2)
})
