/*
  Author: Runor Ewhro
  Description: message contracts for build benchmark worker jobs.
*/

import type {
  BuildBenchmark,
  BuildBenchmarkReport,
  BenchmarkReportOpts,
  DefRotBenchIn,
} from '@/data/scoring/buildBenchmark'
import type { GameDataMode } from '@/domain/entities/gameDataMode'

interface BenchJobBase {
  id: number
  key: string
  gameDataMode?: GameDataMode
}

export interface BenchScoreJob extends BenchJobBase {
  type: 'score'
  payload: DefRotBenchIn
}

export interface BenchDetailJob extends BenchJobBase {
  type: 'benchmark'
  payload: DefRotBenchIn
}

export interface BenchReportJob extends BenchJobBase {
  type: 'report'
  payload: DefRotBenchIn
  benchmark?: BuildBenchmark | null
  options?: BenchmarkReportOpts
  cancelBuf?: SharedArrayBuffer
}

export interface BenchDone {
  id: number
  ok: true
  result: number | BuildBenchmark | BuildBenchmarkReport | null
}

export interface BenchError {
  id: number
  ok: false
  error: string
}

export type BenchWorkerIn =
  | BenchScoreJob
  | BenchDetailJob
  | BenchReportJob

export type BenchWorkerOut =
  | BenchDone
  | BenchError
