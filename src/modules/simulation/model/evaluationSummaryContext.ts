/*
  Author: Runor Ewhro
  description: shares the active evaluation summary with workspace descendants
               without adding a dependency on evaluation state.
*/

import { createContext, useContext } from 'react'
import type { EvaluationSummary } from '@/engine/evaluation/buildEvaluationWorkerTypes'
export const EvaluationSummaryContext = createContext<EvaluationSummary | null>(null)
export const useWorkspaceEvaluationSummary = () => useContext(EvaluationSummaryContext)
