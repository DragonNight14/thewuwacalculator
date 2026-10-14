/*
  Author: Runor Ewhro
  description: tests optimizer worker cancellation, replacement, and synchronous dispatch failures.
*/

import { afterEach, expect, it, vi } from 'vitest'
import type { OptStartPay } from '@/engine/optimizer/types'
import { compOptPayIn, ensOptCompWr, stopOptCompW } from '../storeOptimizerRuntime'
import { useOptimizerRunStore } from '../optimizerRunStore'

class WorkerStub extends EventTarget {
  postMessage = vi.fn()
  terminate = vi.fn()
  onerror = null
}
afterEach(() => { stopOptCompW(); vi.unstubAllGlobals() })
const input = { settings: { includeWeapons: false }, invChs: [] } as unknown as OptStartPay

it('rejects a terminated request and allows a replacement worker to finish', async () => {
  vi.stubGlobal('Worker', WorkerStub)
  const oldWorker = ensOptCompWr()
  const oldJob = compOptPayIn(oldWorker, 1, input)
  const cancelled = expect(oldJob).rejects.toMatchObject({ name: 'AbortError' })
  stopOptCompW()
  const worker = ensOptCompWr()
  const job = compOptPayIn(worker, 2, input)
  const payload = { mode: 'targetSkill' }
  oldWorker.dispatchEvent(new MessageEvent('message', { data: { runId: 1, type: 'done', payload: {} } }))
  worker.dispatchEvent(new MessageEvent('message', { data: { runId: 2, type: 'done', payload } }))
  await cancelled
  await expect(job).resolves.toBe(payload)
  expect((worker as unknown as WorkerStub).terminate).not.toHaveBeenCalled()
})

it('settles synchronous dispatch failures', async () => {
  vi.stubGlobal('Worker', WorkerStub)
  const worker = ensOptCompWr()
  ;(worker as unknown as WorkerStub).postMessage.mockImplementation(() => { throw new Error('clone failed') })
  await expect(compOptPayIn(worker, 1, input)).rejects.toThrow('clone failed')
  stopOptCompW()
})

it('does not start a worker after cancelling while the optimizer module loads', async () => {
  const workers = vi.fn(() => new WorkerStub())
  vi.stubGlobal('Worker', workers)
  const { useAppStore } = await import('../store')
  useAppStore.getState().startOpt({
    ...input,
    settings: { ...input.settings, searchMode: 'inventory', rotationMode: false, enableGpu: false },
  })
  useAppStore.getState().cnclOpt()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(workers).not.toHaveBeenCalled()
  expect(useOptimizerRunStore.getState().status).toBe('cancelled')
})
