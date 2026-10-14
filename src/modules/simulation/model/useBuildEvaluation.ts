/*
  Author: Runor Ewhro
  description: simulation-level hook for default-rotation evaluation reports.
*/

import { runEvaluationSummary } from '@/engine/evaluation/buildEvaluationClient'
import type { EvaluationSummary } from '@/engine/evaluation/buildEvaluationWorkerTypes'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { EvaluationReportOpts, BuildEvaluationReport, DefRotEvaluationIn } from '@/engine/evaluation/buildEvaluation.ts'
import {
  runEvaluationReport,
  cancelEvaluationReport,
  peekEvaluationReport,
  runEvaluationScore,
} from '@/engine/evaluation/buildEvaluationClient.ts'
import type { SimResult } from '@/engine/pipeline/types'
import { scheduleAfterSettled } from '@/shared/lib/scheduleAfterSettled.ts'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario.ts'
import { useAppStore } from '@/application/state'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'

export const FULL_EVALUATION_REPORT_OPTIONS: EvaluationReportOpts = Object.freeze({
  alternativesLimit: 12,
  sections: Object.freeze({
    rotationFeatures: true,
    upgradePaths: true,
    echoStatsTable: true,
    evaluationTargets: true,
  }),
})

// modulation renders the comparison stat sheet before its report drawer opens.
// keep exactly those target snapshots, while deferring feature charts and the
// alternative search until the user requests the report.
export const MODULATION_SUMMARY_REPORT_OPTIONS: EvaluationReportOpts = Object.freeze({
  alternativesLimit: 0,
  sections: Object.freeze({
    rotationFeatures: false,
    upgradePaths: false,
    echoStatsTable: true,
    evaluationTargets: true,
  }),
})

export interface EvaluationReportSt {
  report: BuildEvaluationReport | null
  loading: boolean
  error: Error | null
  refresh: () => void
}

interface EvaluationPayloadIn {
  runtime: ResRuntime
  simulation: SimResult | null
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
}

function compactEvaluationSimulation(
  simulation: SimResult | null,
): DefRotEvaluationIn['simulation'] {
  if (!simulation) return null

  // rotation scoring reads only sequence entries. do not copy the live result's
  // final stats, flattened rows, program, or totals across the worker boundary.
  return {
    rotation: {
      sequence: {
        entries: simulation.rotation.sequence.entries,
      },
    },
  }
}

function mkEvaluationPayload({
  runtime,
  simulation,
  enemy,
  runtimesById,
}: EvaluationPayloadIn): DefRotEvaluationIn {
  const scenario = selectedCombatScenario(useAppStore.getState().combat)
  const member = scenario.team.members.find((candidate) => candidate.resonatorId === runtime.id)
  const teammateRuntimesById = Object.fromEntries(
    Object.entries(runtimesById).filter(([id]) => id !== runtime.id),
  )
  // workers receive one compact payload shape so report cache keys remain stable
  return {
    scenarioId: member ? scenario.id : combatScenarioId('evaluation:detached'),
    memberId: member?.id ?? teamMemberId(runtime.id),
    runtime,
    simulation: compactEvaluationSimulation(simulation),
    enemy,
    runtimesById: teammateRuntimesById,
  }
}

export function useEvaluationReport({
  runtime,
  simulation,
  enemy,
  runtimesById,
  debounceMs = 120,
  enabled = true,
  reportOptions,
  identityKey,
  sourceKey,
  cacheResult = true,
  clearOnDisable = false,
}: {
  runtime: ResRuntime | null
  simulation: SimResult | null
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
  debounceMs?: number
  enabled?: boolean
  reportOptions?: EvaluationReportOpts
  identityKey?: string | null
  sourceKey?: string | null
  cacheResult?: boolean
  clearOnDisable?: boolean
}): EvaluationReportSt {
  const resolvedIdentityKey = identityKey ?? runtime?.id ?? null
  const alternativesLimit = reportOptions?.alternativesLimit ?? 12
  const includeRotationFeatures = reportOptions?.sections?.rotationFeatures ?? true
  const includeUpgradePaths = reportOptions?.sections?.upgradePaths ?? true
  const includeEchoStatsTable = reportOptions?.sections?.echoStatsTable ?? true
  const includeEvaluationTargets = reportOptions?.sections?.evaluationTargets ?? true
  const resolvedReportOptions = useMemo<EvaluationReportOpts>(() => ({
    alternativesLimit,
    sections: {
      rotationFeatures: includeRotationFeatures,
      upgradePaths: includeUpgradePaths,
      echoStatsTable: includeEchoStatsTable,
      evaluationTargets: includeEvaluationTargets,
    },
  }), [
    alternativesLimit,
    includeEchoStatsTable,
    includeEvaluationTargets,
    includeRotationFeatures,
    includeUpgradePaths,
  ])
  // a reduced showcase report and a complete modulation report can otherwise
  // share the same scenario/runtime identity. include the requested report
  // shape so switching surfaces invalidates the old result and schedules the
  // missing sections without treating equivalent default options as different.
  const resolvedReportIdentityKey = resolvedIdentityKey == null
    ? null
    : [
        resolvedIdentityKey,
        alternativesLimit,
        Number(includeRotationFeatures),
        Number(includeUpgradePaths),
        Number(includeEchoStatsTable),
        Number(includeEvaluationTargets),
      ].join(':')
  const [report, setReport] = useState<BuildEvaluationReport | null>(null)
  const [reportIdentityKey, setReportIdentityKey] = useState<string | null>(resolvedReportIdentityKey)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const reportRuntimeRef = useRef(resolvedReportIdentityKey)
  const handledRefreshRef = useRef(0)
  const cachedReport = cacheResult && enabled && runtime && sourceKey
    ? peekEvaluationReport(sourceKey, resolvedReportOptions)
    : undefined
  const hasCachedReport = cachedReport !== undefined

  /* eslint-disable react-hooks/set-state-in-effect -- report state tracks the async report worker lifecycle. */
  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    const force = refreshToken !== handledRefreshRef.current

    if (reportRuntimeRef.current !== resolvedReportIdentityKey) {
      reportRuntimeRef.current = resolvedReportIdentityKey
      setReport(null)
      setReportIdentityKey(resolvedReportIdentityKey)
    }

    if (hasCachedReport && !force) {
      setReport(cachedReport ?? null)
      setReportIdentityKey(resolvedReportIdentityKey)
      setLoading(false)
      setError(null)
      return () => { cancelled = true }
    }

    if (!enabled || !runtime || !simulation) {
      // deferred preparation temporarily removes the simulation on every edit.
      // keep the last completed report for this identity until its replacement
      // arrives; only a missing runtime means there is no result to display.
      if ((enabled && !runtime) || (!enabled && clearOnDisable)) {
        setReport(null)
        setReportIdentityKey(resolvedReportIdentityKey)
      }
      setLoading(Boolean(enabled && runtime))
      setError(null)
      return () => {
        cancelled = true
      }
    }

    const payload = mkEvaluationPayload({
      runtime,
      simulation,
      enemy,
      runtimesById,
    })
    // refresh forces the worker lane past its report cache while ordinary reruns
    // keep using cached reports for the same payload
    handledRefreshRef.current = refreshToken

    setLoading(true)
    setError(null)
    const cancelScheduledReport = scheduleAfterSettled(() => {
      void runEvaluationReport(payload, {
        force,
        reportOptions: resolvedReportOptions,
        cacheResult,
        sourceKey: sourceKey ?? undefined,
      })
        .then((nextReport) => {
          if (!cancelled) {
            setReport(nextReport)
            setReportIdentityKey(resolvedReportIdentityKey)
            setLoading(false)
          }
        })
        .catch((nextError) => {
          if (!cancelled) {
            setLoading(false)
            setError(nextError instanceof Error ? nextError : new Error('Build evaluation report failed'))
          }
        })
    }, { settleDelayMs: Math.max(220, debounceMs) })

    return () => {
      cancelled = true
      cancelScheduledReport()
      cancelEvaluationReport()
    }
  }, [
    debounceMs,
    cacheResult,
    cachedReport,
    clearOnDisable,
    enabled,
    enemy,
    refreshToken,
    resolvedReportIdentityKey,
    resolvedReportOptions,
    runtimesById,
    runtime,
    simulation,
    sourceKey,
    hasCachedReport,
  ])
  /* eslint-enable react-hooks/set-state-in-effect */
  const reportIsCurrent = reportIdentityKey === resolvedReportIdentityKey
  return {
    report: hasCachedReport ? cachedReport ?? null : reportIsCurrent ? report : null,
    loading: hasCachedReport ? false : loading || Boolean(enabled && runtime && simulation && !reportIsCurrent),
    error: hasCachedReport ? null : error,
    refresh,
  }
}

export function useSuggestionsRailScore({
  runtime, enemy, runtimesById, identityKey, enabled,
}: {
  runtime: ResRuntime | null
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
  identityKey: string | null
  enabled: boolean
}): number | null {
  const [reading, setReading] = useState<{ identity: string | null; percent: number | null }>({ identity: null, percent: null })
  useEffect(() => {
    if (!enabled || !runtime) return
    let valid = true
    const fullPayload = mkEvaluationPayload({
      runtime, simulation: null, enemy, runtimesById,
    })
    const payload = {
      scenarioId: fullPayload.scenarioId,
      memberId: fullPayload.memberId,
      runtime: fullPayload.runtime,
      enemy: fullPayload.enemy,
      runtimesById: fullPayload.runtimesById,
    }
    const cancelScheduled = scheduleAfterSettled(() => {
      void runEvaluationScore(payload).then((percent) => {
        if (valid) setReading({ identity: identityKey, percent })
      }).catch((error) => {
        if (valid && error instanceof Error && error.message !== 'Evaluation cancelled') {
          console.error('[Suggestions] rail score failed', error)
        }
      })
    }, { settleDelayMs: 220 })
    return () => {
      valid = false
      cancelScheduled()
      cancelEvaluationReport()
    }
  }, [enabled, enemy, identityKey, runtime, runtimesById])
  return reading.identity === identityKey ? reading.percent : null
}

export function useEvaluationSummary({
  runtime, enemy, runtimesById, identityKey, enabled,
}: {
  runtime: ResRuntime | null
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
  identityKey: string | null
  enabled: boolean
}): EvaluationSummary | null {
  const [reading, setReading] = useState<{ identity: string | null; summary: EvaluationSummary | null }>({ identity: null, summary: null })
  useEffect(() => {
    if (!enabled || !runtime) return
    let valid = true
    const fullPayload = mkEvaluationPayload({
      runtime, simulation: null, enemy, runtimesById,
    })
    const payload = {
      scenarioId: fullPayload.scenarioId,
      memberId: fullPayload.memberId,
      runtime: fullPayload.runtime,
      enemy: fullPayload.enemy,
      runtimesById: fullPayload.runtimesById,
    }
    const cancelScheduled = scheduleAfterSettled(() => {
      void runEvaluationSummary(payload).then((summary) => {
        if (valid) setReading({ identity: identityKey, summary })
      }).catch((error) => {
        if (valid && error instanceof Error && error.message !== 'Evaluation cancelled') {
          console.error('[Evaluation] rail score failed', error)
        }
      })
    }, { settleDelayMs: 320 })
    return () => {
      valid = false
      cancelScheduled()
      cancelEvaluationReport()
    }
  }, [enabled, enemy, identityKey, runtime, runtimesById])
  return reading.identity === identityKey ? reading.summary : null
}
