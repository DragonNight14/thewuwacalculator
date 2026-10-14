/*
  Author: Runor Ewhro
  description: stores transient optimizer progress, prepared payloads, results, and cancellation state.
*/

import { create } from 'zustand'
import type { EchoInstance } from '@/domain/entities/runtime'
import type {
  OptPrgr, OptRawResult, OptStoredResult, OptStts, PrepOptPay,
} from '@/engine/optimizer/types'

export interface OptimizerRunState {
  status: OptStts
  progress: OptPrgr | null
  results: Array<OptRawResult | OptStoredResult>
  error: string | null
  batchSize: number | null
  resPay: PrepOptPay | null
  resultEchoes: EchoInstance[]
}

export function idleOptimizerRun(): OptimizerRunState {
  return {
    status: 'idle', progress: null, results: [], error: null,
    batchSize: null, resPay: null, resultEchoes: [],
  }
}

export const useOptimizerRunStore = create<OptimizerRunState>(() => idleOptimizerRun())

export function updateOptimizerRun(updater: (state: OptimizerRunState) => OptimizerRunState): void {
  useOptimizerRunStore.setState(updater)
}

export function resetOptimizerRun(): void {
  useOptimizerRunStore.setState(idleOptimizerRun())
}
