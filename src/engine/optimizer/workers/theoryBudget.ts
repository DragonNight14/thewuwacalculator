/*
  Author: Runor Ewhro
  description: bounds theory producer count and batch size by their aggregate
               typed-array memory budget.
*/

import { ECHOES_PER_SET } from '@/engine/search/layout/constants'
import { THEORY_BUFFER_BYTES, THEORY_LOW_MEMORY_BUFFER_BYTES } from '../config/constants'

/** one credit per producer, reserving its maximum adaptive buffer capacity. */
export function theoryBufferPlan(requestedBatch: number, requestedProducers: number, lowMemory: boolean, maximumBatch = requestedBatch) {
  const budgetBytes = lowMemory ? THEORY_LOW_MEMORY_BUFFER_BYTES : THEORY_BUFFER_BYTES
  const bytesPerCombo = ECHOES_PER_SET * Int32Array.BYTES_PER_ELEMENT
  const batchSize = Math.max(1, Math.min(requestedBatch, Math.floor(budgetBytes / bytesPerCombo)))
  const reservedBatch = Math.max(batchSize, Math.min(maximumBatch, Math.floor(budgetBytes / bytesPerCombo)))
  const producers = Math.max(1, Math.min(requestedProducers, Math.floor(budgetBytes / (reservedBatch * bytesPerCombo))))
  return { budgetBytes, batchSize, producers }
}
