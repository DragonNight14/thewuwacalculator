/*
  Author: Runor Ewhro
  description: verifies concurrent suggestion requests are correlated and all
               pending work is rejected during transport teardown.
*/

import { afterEach, expect, it, vi } from 'vitest'
import type { MainStatPrep, PrepSetPlanS, SuggsWrkrOut } from '../types'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('correlates concurrent suggestion jobs and cancels every request on teardown', async () => {
  const workers: StubWorker[] = []
  class StubWorker {
    constructor() { workers.push(this) }
    onmessage: ((event: MessageEvent<SuggsWrkrOut>) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    postMessage = vi.fn()
    terminate = vi.fn()
    reply(message: SuggsWrkrOut): void { this.onmessage?.({ data: message } as MessageEvent<SuggsWrkrOut>) }
  }
  vi.stubGlobal('Worker', StubWorker)
  const client = await import('../client')

  const main = client.runMainStatS({} as MainStatPrep)
  const sets = client.runSetPlanSu({} as PrepSetPlanS)
  const [mainRequest, setRequest] = workers[0]!.postMessage.mock.calls.map(([message]) => message)
  expect([mainRequest.type, setRequest.type]).toEqual(['mainStats', 'setPlans'])
  client.disposeSuggestionsWorker()
  expect(workers[0]!.terminate).not.toHaveBeenCalled()
  workers[0]!.reply({ id: setRequest.id, ok: true, result: [] })
  workers[0]!.reply({ id: mainRequest.id, ok: true, result: [] })
  await expect(main).resolves.toEqual([])
  await expect(sets).resolves.toEqual([])

  const pending = client.runMainStatS({} as MainStatPrep)
  const cancelled = expect(pending).rejects.toThrow('Suggestions cancelled')
  client.cancelSuggestionsJobs()
  await cancelled
  expect(workers[0]!.terminate).toHaveBeenCalledOnce()
  const next = client.runMainStatS({} as MainStatPrep)
  expect(workers).toHaveLength(2)
  const nextRequest = workers[1]!.postMessage.mock.calls[0]![0]
  workers[1]!.reply({ id: nextRequest.id, ok: true, result: [] })
  await expect(next).resolves.toEqual([])
  client.disposeSuggestionsWorker()
})
