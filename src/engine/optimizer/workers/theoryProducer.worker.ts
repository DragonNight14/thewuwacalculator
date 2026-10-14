/*
  Author: Runor Ewhro
  description: streams theory-mode combo batches from the synthetic row space
               on a dedicated worker so the orchestrating thread never blocks
               on combo generation between worker dispatches.
*/

/// <reference lib="webworker" />

import { initEchoSetD } from '@/data/gameData/echoSets/effects'
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
): Promise<void> {
  const t0 = performance.now()
  let generated = 0
  let batchesEmitted = 0

  const { gnrtThryCpuCm } = await import('@/engine/optimizer/target/theoryBatches.ts')
  const iterator = gnrtThryCpuCm({
    payload,
    batchSize,
    shard,
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

scope.onmessage = (event: MessageEvent<OptThryProdIn>) => {
  const message = event.data

  if (message.type === 'returnTheoryBuffer') {
    if (activeRunId === message.runId && !cancelled && !credit) {
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

  // start
  wakeCredit?.()
  wakeCredit = null
  credit = true
  activeRunId = message.runId
  cancelled = false
  freeBuffers.length = 0

  logOptimizer('[optimizer:theory-producer] run start', {
    runId: message.runId,
    theoryRows: message.payload.theoryRows.length,
    batchSize: message.batchSize,
    shard: message.shard,
  })

  initEchoSetD(message.echoSetDefs)
  void runProducer(message.runId, message.payload, message.batchSize, message.shard).catch((error) => {
    errorOpt('[optimizer:theory-producer] error', {
      runId: message.runId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    postError(message.runId, error)
  })
}
