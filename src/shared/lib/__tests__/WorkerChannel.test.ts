/*
  Author: Runor Ewhro
  description: verifies worker request correlation, progress delivery,
               transferable payloads, idle release, and failure teardown.
*/

import { afterEach, expect, it, vi } from 'vitest'
import { WorkerChannel } from '../WorkerChannel'

type Request = { id: number; value: string }
type Reply = { id: number; kind: 'progress' | 'done'; value: string }

afterEach(() => { vi.useRealTimers() })

it('correlates concurrent replies, progress, transfers, and idle teardown', async () => {
  vi.useFakeTimers()
  const workers: WorkerStub[] = []
  class WorkerStub {
    constructor() { workers.push(this) }
    onmessage: ((event: MessageEvent<Reply>) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    postMessage = vi.fn()
    terminate = vi.fn()
    reply(message: Reply): void { this.onmessage?.({ data: message } as MessageEvent<Reply>) }
  }
  const channel = new WorkerChannel<Request, Reply>({
    createWorker: () => new WorkerStub() as unknown as Worker,
    idleMs: 100,
    errorMessage: 'failed',
    isProgress: (reply) => reply.kind === 'progress',
  })
  const progress = vi.fn()
  const buffer = new ArrayBuffer(4)
  const first = channel.request((id) => ({ id, value: 'first' }), { transfer: [buffer], onProgress: progress })
  const second = channel.request((id) => ({ id, value: 'second' }))
  expect(workers).toHaveLength(1)
  expect(workers[0]!.postMessage).toHaveBeenNthCalledWith(1, { id: 1, value: 'first' }, [buffer])
  workers[0]!.reply({ id: 1, kind: 'progress', value: 'half' })
  expect(progress).toHaveBeenCalledWith({ id: 1, kind: 'progress', value: 'half' })
  workers[0]!.reply({ id: 2, kind: 'done', value: 'second' })
  expect(await second).toMatchObject({ value: 'second' })
  vi.advanceTimersByTime(100)
  expect(workers[0]!.terminate).not.toHaveBeenCalled()
  workers[0]!.reply({ id: 1, kind: 'done', value: 'first' })
  expect(await first).toMatchObject({ value: 'first' })
  vi.advanceTimersByTime(100)
  expect(workers[0]!.terminate).toHaveBeenCalledOnce()
})

it('rejects every pending request on worker failure and can start a fresh worker', async () => {
  const workers: WorkerStub[] = []
  class WorkerStub {
    constructor() { workers.push(this) }
    onmessage: ((event: MessageEvent<Reply>) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    postMessage = vi.fn()
    terminate = vi.fn()
  }
  const channel = new WorkerChannel<Request, Reply>({
    createWorker: () => new WorkerStub() as unknown as Worker,
    idleMs: 100,
    errorMessage: 'failed',
  })
  const first = channel.request((id) => ({ id, value: 'first' }))
  const second = channel.request((id) => ({ id, value: 'second' }))
  workers[0]!.onerror?.({ message: 'broken' } as ErrorEvent)
  await expect(first).rejects.toThrow('broken')
  await expect(second).rejects.toThrow('broken')
  expect(workers[0]!.terminate).toHaveBeenCalledOnce()
  const third = channel.request((id) => ({ id, value: 'third' }))
  expect(workers).toHaveLength(2)
  workers[1]!.onmessage?.({ data: { id: 3, kind: 'done', value: 'third' } } as MessageEvent<Reply>)
  await expect(third).resolves.toMatchObject({ value: 'third' })
  channel.disposeIfIdle()
})
