/*
  Author: Runor Ewhro
  description: defines compile worker requests, responses, and result references.
*/

import type { OptStoredResult, OptRawResult, OptStartPay, PrepOptPay } from '@/engine/optimizer/types.ts'
import type { OptResultStats } from '@/engine/search/score/core.ts'

// message sent to the compile worker to begin compiling a raw optimizer payload
export interface OptCompStart {
  type: 'start'
  runId: number
  payload: OptStartPay
}

// response sent back when compilation succeeds
export interface OptCompDoneM {
  type: 'done'
  runId: number
  payload: PrepOptPay
}

export type OptBaselineInput = Omit<OptStartPay, 'settings' | 'weaponPlan'> & {
  settings: Pick<OptStartPay['settings'], 'rotationMode' | 'targetSkillId'>
}

export interface OptBaselineStartM {
  type: 'baseline'
  runId: number
  payload: OptBaselineInput
  mainIndex: number
}

export interface OptBaselineDoneM {
  type: 'baselineDone'
  runId: number
  result: { damage: number; stats: OptResultStats | null } | null
}

// message sent to the worker when we already have a prepared payload
// and only need to materialize compact bag results into user-facing entries
export interface OptMatStartM {
  type: 'materialize'
  runId: number
  payload: PrepOptPay
  results: OptRawResult[]
  uidByIndex: string[]
  limit?: number
}

// response sent back after materialization completes
export interface OptMatDoneMs {
  type: 'materialized'
  runId: number
  results: OptStoredResult[]
}

// generic worker error response used for either compile or materialize failures
export interface OptCompRrrMs {
  type: 'error'
  runId: number
  message: string
}

// all valid inbound messages accepted by the compile worker
export type OptCompInMsg =
    | OptCompStart
    | OptBaselineStartM
    | OptMatStartM

// all valid outbound messages produced by the compile worker
export type OptCompOutMs =
    | OptCompDoneM
    | OptBaselineDoneM
    | OptMatDoneMs
    | OptCompRrrMs
