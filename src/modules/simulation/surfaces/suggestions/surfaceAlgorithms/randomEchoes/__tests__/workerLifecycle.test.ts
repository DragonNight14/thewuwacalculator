/*
  Author: Runor Ewhro
  description: verifies that random echo suggestion workers are reused during
               active bursts and released after their idle grace period.
*/

import { afterEach, expect, it, vi } from 'vitest'
import { runRandomEchoSuggestions } from '../client.ts'
import type { RandomEchoPrep, RandomEchoWorkerResponse } from '../types.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('releases the random Echo worker after the last result and reuses it during a short burst', async () => {
  vi.useFakeTimers()
  const workers: WorkerStub[] = []
  class WorkerStub {
    constructor() { workers.push(this) }
    onmessage: ((event: MessageEvent<RandomEchoWorkerResponse>) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    postMessage = vi.fn()
    terminate = vi.fn()
  }
  vi.stubGlobal('Worker', WorkerStub)

  const first = runRandomEchoSuggestions({} as RandomEchoPrep)
  expect(workers).toHaveLength(1)
  workers[0]!.onmessage?.({ data: { id: 1, ok: true, result: [] } } as unknown as MessageEvent<RandomEchoWorkerResponse>)
  await expect(first).resolves.toEqual([])
  vi.advanceTimersByTime(600)

  const second = runRandomEchoSuggestions({} as RandomEchoPrep)
  expect(workers).toHaveLength(1)
  workers[0]!.onmessage?.({ data: { id: 2, ok: true, result: [] } } as unknown as MessageEvent<RandomEchoWorkerResponse>)
  await expect(second).resolves.toEqual([])
  vi.advanceTimersByTime(1_199)
  expect(workers[0]!.terminate).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(workers[0]!.terminate).toHaveBeenCalledOnce()
})
