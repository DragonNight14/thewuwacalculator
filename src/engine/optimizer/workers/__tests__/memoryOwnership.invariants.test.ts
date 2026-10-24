/*
  Author: Runor Ewhro
  description: tests optimizer buffer sharing, transfers, producer budgets, capacity, and cancellation.
*/

import { afterEach, describe, expect, it, vi } from 'vitest'
import { payloadTransfers, sharePayload } from '@/engine/search/layout/buffers'
import { theoryBufferPlan } from '../theoryBudget'

afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('@/engine/optimizer/target/theoryBatches.ts') })

describe('optimizer buffer references', () => {
  it('covers optional weapon arrays and deduplicates views of the same buffer', () => {
    const storage = new Float32Array([1, 2, 3, 4])
    const weapon = new Float32Array([9])
    const payload = { stats: storage, contexts: storage.subarray(1), weaponContexts: weapon, weaponDisplayContexts: weapon }
    expect(payloadTransfers(payload)).toEqual([storage.buffer, weapon.buffer])
    const result = sharePayload(payload)
    expect([...result.contexts]).toEqual([2, 3, 4])
    expect(result.contexts.buffer).toBe(result.stats.buffer)
    expect(result.weaponContexts.buffer).toBe(result.weaponDisplayContexts.buffer)
    expect(payloadTransfers(result)).toEqual([])
    expect(sharePayload(result).stats).toBe(result.stats)
  })

  it('keeps transferable storage when shared memory is unavailable', () => {
    vi.stubGlobal('SharedArrayBuffer', undefined)
    const payload = { weaponOverlays: new Float32Array([3]) }
    expect(sharePayload(payload)).toBe(payload)
    expect(payloadTransfers(payload)).toEqual([payload.weaponOverlays.buffer])
  })

  it.each([false, true])('bounds aggregate batches including oversized requests (low memory %s)', (lowMemory) => {
    for (const size of [1, 100_000, 1_000_000, 10_000_000]) {
      const plan = theoryBufferPlan(size, 6, lowMemory)
      expect(plan.producers * plan.batchSize * 20).toBeLessThanOrEqual(plan.budgetBytes)
      expect(plan.producers).toBeGreaterThan(0)
      expect(plan.batchSize).toBeGreaterThan(0)
    }
  })

  it('waits for returned capacity before advancing a theory producer and wakes on cancellation', async () => {
    vi.resetModules()
    let advances = 0
    vi.doMock('@/engine/optimizer/target/theoryBatches.ts', () => ({
      *gnrtThryCpuCm() {
        for (let i = 0; i < 3; i++) {
          advances++
          yield { combos: new Int32Array(5), comboCount: 1, lockMainIdx: 0 }
        }
      },
    }))
    const scope = { postMessage: vi.fn(), onmessage: null as null | ((event: MessageEvent) => void) }
    vi.stubGlobal('self', scope)
    await import('../theoryProducer.worker')
    const send = (data: object) => scope.onmessage!({ data } as MessageEvent)
    send({ type: 'startTheoryProducer', runId: 7, payload: { theoryRows: [], profs: [] }, echoSetDefs: [], batchSize: 1 })
    await vi.waitFor(() => expect(advances).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 15))
    expect(advances).toBe(1)
    send({ type: 'returnTheoryBuffer', runId: 6 })
    expect(advances).toBe(1)
    send({ type: 'returnTheoryBuffer', runId: 7 })
    await vi.waitFor(() => expect(advances).toBe(2))
    send({ type: 'cancelTheoryProducer', runId: 7 })
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'theoryProducerDone', runId: 7 })))
    expect(advances).toBe(2)
  })
})
