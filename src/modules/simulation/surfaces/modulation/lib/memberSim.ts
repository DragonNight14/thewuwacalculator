/*
  Author: Runor Ewhro
  description: derives member progression analysis from the shared workspace
               and simulation.
*/

import { useCallback } from 'react'
import type { CombatScenario } from '@/domain/entities/combatScenario.ts'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { SimResult } from '@/engine/pipeline/types'
import type { PrepWork } from '@/engine/pipeline/preparedWorkspace'
import { makeStateSummary, type StateGroup, type StatStateSummaryTarget } from '@/modules/simulation/model/stateSummary.ts'

export interface MemberAnalysis {
  simulation: SimResult | null
  stateGroupsForStat: (statKey: string, scope?: StatStateSummaryTarget['scope']) => StateGroup[]
}

export interface MemberAnalysisSource {
  scenario: CombatScenario
  subjectRuntime: ResRuntime
  runtimesById: Record<string, ResRuntime>
  selectedTargets: Record<string, string | null>
  workspace: PrepWork | null
  simulation: SimResult | null
}

export function useMemberAnalysis(
  runtime: ResRuntime | null,
  source: MemberAnalysisSource | null,
): MemberAnalysis {
  const memberId = runtime?.id ?? null
  const analyzedRuntime = memberId ? source?.runtimesById[memberId] ?? runtime : null
  const combatGraph = source?.workspace?.combatGraph ?? null
  const simulation = source?.simulation ?? null
  const stateGroupsForStat = useCallback((statKey: string, scope?: StatStateSummaryTarget['scope']) => makeStateSummary(
    analyzedRuntime,
    source?.runtimesById ?? {},
    combatGraph,
    source?.selectedTargets ?? {},
    {
      cntxByResId: source?.workspace?.cntxByResId,
      enemyProfile: source?.scenario.target,
      activeRuntime: source?.subjectRuntime,
      statTarget: { key: statKey, scope },
    },
  ), [analyzedRuntime, combatGraph, source])

  return { simulation, stateGroupsForStat }
}
