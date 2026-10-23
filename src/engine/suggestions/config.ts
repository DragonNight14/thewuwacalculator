/*
  Author: Runor Ewhro
  description: defines bounded worker, batching, startup, and score-cache limits
               for parallel Suggestions searches.
*/
export const SUGGESTION_WORKERS = {
  sampleCandidates: 128,
  minimumParallelMs: 80,
  startupMargin: 1.15,
  maxWorkers: 3,
  batchCandidates: 256,
} as const

export const SUGGESTION_SCORE_CACHE_LIMIT = 8192
