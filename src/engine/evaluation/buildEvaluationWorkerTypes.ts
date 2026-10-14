/*
  Author: Runor Ewhro
  description: message contracts for build evaluation worker jobs.
*/

import type { BuildEvaluationReport, EvaluationReportOpts, DefRotEvaluationIn } from '@/engine/evaluation/buildEvaluation'
import type { ShowcaseAnalysisInput, ShowcaseAnalysisResult, ShowcaseAnalysisProgress } from './showcaseAnalysis'
import type { GameDataMode } from '@/domain/entities/gameDataMode'

interface EvaluationJobBase {
  id: number
  key: string
  gameDataMode?: GameDataMode
}

export interface EvaluationReportJob extends EvaluationJobBase {
  type: 'report'
  payload: DefRotEvaluationIn
  options?: EvaluationReportOpts
  cancelBuf?: SharedArrayBuffer
}

export interface EvaluationSummary {
  percent: number | null
  userDamage: number
  baselineDamage: number
  referenceDamage: number
  maximumDamage: number
}

export interface EvaluationSummaryJob extends EvaluationJobBase {
  type: 'summary'
  payload: Omit<DefRotEvaluationIn, 'simulation'>
  cancelBuf?: SharedArrayBuffer
}

export interface EvaluationScoreJob extends EvaluationJobBase {
  type: 'score'
  payload: Omit<DefRotEvaluationIn, 'simulation'>
  cancelBuf?: SharedArrayBuffer
}

export interface ShowcaseAnalysisJob extends EvaluationJobBase {
  type: 'showcase'
  payload: ShowcaseAnalysisInput
  cancelBuf?: SharedArrayBuffer
}

export interface EvaluationDone {
  id: number
  ok: true
  result: EvaluationSummary | BuildEvaluationReport | ShowcaseAnalysisResult | number | null
}

export interface EvaluationError {
  id: number
  ok: false
  error: string
}

export type EvaluationWorkerIn =
  EvaluationReportJob | EvaluationScoreJob | EvaluationSummaryJob | ShowcaseAnalysisJob

export type EvaluationWorkerOut =
  | EvaluationDone
  | EvaluationError
  | { id: number; progress: ShowcaseAnalysisProgress }
