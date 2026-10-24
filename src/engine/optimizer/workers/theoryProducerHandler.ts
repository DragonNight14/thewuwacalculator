/*
  Author: Runor Ewhro
  description: generates theory combo batches in a dedicated worker.
*/

/// <reference lib="webworker" />

import { initEchoSetD } from '@/data/gameData/echoSets/effects'
import { theoryBranchBound, type TheoryBoundsPayload } from '@/engine/rotation/portable/bounds'
import type {
  OptThryProdIn,
  OptThryProdBt,
  OptThryProdDn,
  OptThryProdRr,
} from '@/engine/optimizer/workers/messages.ts'
import { errorOpt, logOptimizer } from '@/engine/optimizer/config/log.ts'

const scope = self as DedicatedWorkerGlobalScope

let activeRunId: number | null = null
let cancelled = false
let credit = true
let wakeCredit: (() => void) | null = null
let cutoff = 0
let requestedBatchSize = 0

// returned batch buffers waiting to be reused by the next emit.
const freeBuffers: Int32Array[] = []

function postError(runId: number, error: unknown): void {
  const message: OptThryProdRr = {
    type: 'theoryProducerError',
    runId,
    message: error instanceof Error ? error.message : 'Theory producer worker failed unexpectedly',
  }
  scope.postMessage(message)
}

// yield to the message loop so cancellation messages and buffer returns can land.
function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

async function runProducer(
    runId: number,
    payload: Extract<OptThryProdIn, { type: 'startTheoryProducer' }>['payload'],
    batchSize: number,
    shard?: { index: number; count: number },
    bounds?: TheoryBoundsPayload,
): Promise<void> {
  const t0 = performance.now()
  let generated = 0
  let batchesEmitted = 0

  const { gnrtThryCpuCm } = await import('@/engine/optimizer/target/theoryBatches.ts')
  const bound = bounds ? theoryBranchBound(bounds) : null
  let pruned = 0
  const iterator = gnrtThryCpuCm({
    payload,
    batchSize,
    getBatchSize: () => requestedBatchSize,
    shard,
    prune: bound ? (main, first, remaining) => bound(main, first, remaining, cutoff) : undefined,
    onPruned: (count) => { pruned += count },
    borrowBuffer: (length) => {
      while (freeBuffers.length > 0) {
        const buffer = freeBuffers.pop()!
        if (buffer.length === length) {
          return buffer
        }
      }
      return new Int32Array(length)
    },
  })

  while (true) {
    if (activeRunId !== runId || cancelled) {
      break
    }

    if (!credit) await new Promise<void>((resolve) => { wakeCredit = resolve })
    if (activeRunId !== runId || cancelled) break
    credit = false
    const next = iterator.next()
    if (pruned) {
      scope.postMessage({ type: 'theoryPruned', runId, count: pruned })
      pruned = 0
    }
    if (next.done) {
      break
    }

    const batch = next.value
    generated += batch.comboCount
    batchesEmitted += 1

    const message: OptThryProdBt = {
      type: 'theoryBatch',
      runId,
      combos: batch.combos,
      comboCount: batch.comboCount,
      lockMainIdx: batch.lockMainIdx,
    }
    scope.postMessage(message, [batch.combos.buffer])

    // give the worker event loop a turn so cancel / returnTheoryBuffer messages
    // can be processed without waiting for the next batch.
    await yieldToLoop()
  }

  if (activeRunId !== runId) {
    return
  }

  const done: OptThryProdDn = {
    type: 'theoryProducerDone',
    runId,
    generated,
  }

  logOptimizer('[optimizer:theory-producer] run done', {
    runId,
    generated,
    batchesEmitted,
    elapsedMs: Math.round(performance.now() - t0),
  })

  scope.postMessage(done)
}

export function handleMessage(event: MessageEvent<OptThryProdIn>) {
  const message = event.data

  if (message.type === 'returnTheoryBuffer') {
    if (activeRunId === message.runId && !cancelled && !credit) {
      cutoff = Math.max(cutoff, message.cutoff ?? 0)
      if (message.nextBatchSize && message.nextBatchSize > 0) requestedBatchSize = message.nextBatchSize
      if (message.buffer) freeBuffers.push(message.buffer)
      credit = true
      wakeCredit?.()
      wakeCredit = null
    }
    return
  }

  if (message.type === 'cancelTheoryProducer') {
    if (activeRunId === message.runId) {
      cancelled = true
      freeBuffers.length = 0
      wakeCredit?.()
      wakeCredit = null
    }
    return
  }

  wakeCredit?.()
  wakeCredit = null
  credit = true
  activeRunId = message.runId
  cancelled = false
  cutoff = 0
  requestedBatchSize = message.batchSize
  freeBuffers.length = 0

  logOptimizer('[optimizer:theory-producer] run start', {
    runId: message.runId,
    theoryRows: message.payload.theoryRows.length,
    batchSize: message.batchSize,
    shard: message.shard,
  })

  initEchoSetD(message.echoSetDefs)
  void runProducer(message.runId, message.payload, message.batchSize, message.shard, message.bounds).catch((error) => {
    errorOpt('[optimizer:theory-producer] error', {
      runId: message.runId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    postError(message.runId, error)
  })
}
