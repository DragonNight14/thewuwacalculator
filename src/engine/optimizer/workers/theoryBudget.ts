/*
  Author: Runor Ewhro
  description: bounds theory producer count and batch size by their aggregate
               typed-array memory budget.
*/

/** each producer receives one credit: scratch, queued, executing, or returned. */
export function theoryBufferPlan(requestedBatch: number, requestedProducers: number, lowMemory: boolean) {
  const budgetBytes = (lowMemory ? 16 : 64) * 1024 * 1024
  const batchSize = Math.max(1, Math.min(requestedBatch, Math.floor(budgetBytes / 20)))
  const producers = Math.max(1, Math.min(requestedProducers, Math.floor(budgetBytes / (batchSize * 20))))
  return { budgetBytes, batchSize, producers }
}
