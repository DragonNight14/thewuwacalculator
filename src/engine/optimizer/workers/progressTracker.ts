/*
  Author: Runor Ewhro
  description: tracks optimizer discovery and evaluation progress with bounded
               wall-clock throughput estimates.
*/

import type { OptPrgr } from '@/engine/optimizer/types'

import { PROGRESS_RATE_MIN_MS, PROGRESS_RATE_WINDOW_MS } from '../config/constants'

export function mkPrgrTrck(
    ttlForPrgr: number,
    onProgress?: (progress: OptPrgr) => void,
    initialPhase: import('@/engine/optimizer/types').OptPrgrPh = 'evaluating',
) {
  let curTotal = Math.max(0, ttlForPrgr)
  let ttlPrcs = 0
  let phase: import('@/engine/optimizer/types').OptPrgrPh = initialPhase
  let discovered = 0
  const startTime = performance.now()
  let evalStart = initialPhase === 'evaluating' ? startTime : 0
  const ratePts: Array<{ time: number; done: number }> = []

  // report conservative throughput over elapsed wall-clock time.
  // worker progress arrives in chunks, so instantaneous rates can be
  // much higher than the run can sustain.
  const calcSpeed = (now: number) => {
    if (phase !== 'evaluating' || evalStart <= 0) {
      return 0
    }

    const done = curTotal > 0 ? Math.min(ttlPrcs, curTotal) : ttlPrcs
    const elapsed = now - evalStart
    if (done <= 0 || elapsed < PROGRESS_RATE_MIN_MS) {
      return 0
    }

    const fullRate = done / elapsed
    const cutoff = now - PROGRESS_RATE_WINDOW_MS
    while (ratePts.length > 1 && ratePts[0].time < cutoff) {
      ratePts.shift()
    }

    const base = ratePts[0]
    if (!base || now - base.time < PROGRESS_RATE_MIN_MS || done <= base.done) {
      return fullRate
    }

    const winRate = (done - base.done) / (now - base.time)
    return Math.min(fullRate, winRate)
  }

  const emit = (now: number) => {
    if (!onProgress) {
      return
    }

    const speed = calcSpeed(now)
    let remainingMs = Infinity
    if (phase === 'evaluating' && speed > 0) {
      const combosLeft = Math.max(0, curTotal - ttlPrcs)
      remainingMs = combosLeft / speed
    }

    const progress = curTotal > 0
        ? Math.min(1, ttlPrcs / curTotal)
        : 0

    onProgress({
      progress,
      elapsedMs: now - startTime,
      remainingMs,
      processed: curTotal > 0 ? Math.min(ttlPrcs, curTotal) : ttlPrcs,
      speed: speed * 1000,
      total: curTotal,
      phase,
      discovered,
    })
  }

  // publish the exact denominator before the first worker delta replaces it
  // with an independently estimated upper bound.
  emit(performance.now())

  return {
    // generated batches may raise an estimate; exact totals may also lower it.
    setTotal(total: number, exact = false) {
      curTotal = exact
          ? Math.max(0, total)
          : Math.max(curTotal, total)
      emit(performance.now())
    },

    setDiscovered(count: number) {
      discovered = Math.max(discovered, count)
      emit(performance.now())
    },

    // reset sampling when evaluation begins so discovery throughput cannot
    // skew the evaluation estimate.
    setPhase(next: import('@/engine/optimizer/types').OptPrgrPh) {
      if (phase === next) {
        return
      }
      phase = next
      if (next === 'evaluating') {
        evalStart = performance.now()
        ratePts.length = 0
      }
      emit(performance.now())
    },

    applyPrgr(delta: number) {
      ttlPrcs += delta

      const now = performance.now()
      if (phase === 'evaluating') {
        const done = curTotal > 0 ? Math.min(ttlPrcs, curTotal) : ttlPrcs
        const last = ratePts[ratePts.length - 1]
        if (!last || done > last.done) {
          ratePts.push({ time: now, done })
        }
      }

      emit(now)
    },

    complete() {
      ttlPrcs = curTotal
      emit(performance.now())
    },
  }
}
