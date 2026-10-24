/*
  Author: Runor Ewhro
  description: runs build evaluation jobs inside a dedicated web worker.
*/

/// <reference lib="webworker" />

import { computeShowcaseAnalysis } from './showcaseAnalysis'
import { initGameData } from '@/data/gameData'
import {
  ensureAnchorStoreHydrated,
  rotationBuildEvaluationReport,
} from '@/engine/evaluation/buildEvaluation'
import { prepareRotationBuildScore } from '@/engine/evaluation/report.ts'
import type {
  EvaluationWorkerIn,
  EvaluationWorkerOut,
} from '@/engine/evaluation/buildEvaluationWorkerTypes'

const scope = self as DedicatedWorkerGlobalScope
const REPORT_CANCEL_ERR = 'Build evaluation report superseded'

function makeCancelCheck(message: EvaluationWorkerIn): (() => void) | undefined {
  if (!message.cancelBuf) {
    return undefined
  }

  const view = new Int32Array(message.cancelBuf)
  return () => {
    if (Atomics.load(view, 0) !== 0) {
      throw new Error(REPORT_CANCEL_ERR)
    }
  }
}

function buildReport(message: Extract<EvaluationWorkerIn, { type: 'report' }>): ReturnType<typeof rotationBuildEvaluationReport> {
  return rotationBuildEvaluationReport(
    message.payload,
    message.options ?? {},
    makeCancelCheck(message),
  )
}

scope.onmessage = async (event: MessageEvent<EvaluationWorkerIn>) => {
  const message = event.data

  try {
    const contexts = message.type === 'showcase' ? [message.payload.evaluation, message.payload.live] : [message.payload]
    const participants = contexts.flatMap((context) => [context.runtime, ...Object.values(context.runtimesById)])
    const resonatorIds = [...new Set(participants.map((runtime) => runtime.id))]
    await initGameData({ mode: message.gameDataMode, resonatorIds, calculationOnly: true,
      weaponIds: participants.flatMap((runtime) => runtime.build.weapon.id ? [runtime.build.weapon.id] : []),
    })
    // rehydrate persisted anchors before the first search. a cold worker after
    // idle teardown or page reload can then score from disk.
    if (message.type === 'report' || message.type === 'score' || message.type === 'summary') await ensureAnchorStoreHydrated()
    makeCancelCheck(message)?.()
    const result = message.type === 'report' ? buildReport(message)
      : message.type === 'summary' ? prepareRotationBuildScore(message.payload)?.calculateSummary(makeCancelCheck(message)) ?? null
      : message.type === 'score' ? prepareRotationBuildScore(message.payload)?.calculatePercent(makeCancelCheck(message)) ?? null
      : await computeShowcaseAnalysis(
      message.payload,
      makeCancelCheck(message),
      (progress) => scope.postMessage({ id: message.id, progress } satisfies EvaluationWorkerOut),
    )

    const response: EvaluationWorkerOut = {
      id: message.id,
      ok: true,
      result,
    }
    scope.postMessage(response)
  } catch (error) {
    const response: EvaluationWorkerOut = {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Build evaluation worker failed unexpectedly',
    }
    scope.postMessage(response)
  }
}
