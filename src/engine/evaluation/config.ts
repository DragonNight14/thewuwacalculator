/*
  Author: Runor Ewhro
  description: defines the bounded search and replay budgets used by build
               evaluation.
*/
export const EVALUATION_SEARCH = {
  frameLimit: 128,
  referenceFrameLimit: 32,
  mainCandidateLimit: 256,
  referenceRefinementLimit: 8,
} as const

export const EVALUATION_REPLAY_FRAMES = 16
