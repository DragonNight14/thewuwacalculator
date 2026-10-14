/*
  Author: Runor Ewhro
  description: prepares a deferred evaluation simulation for the selected target.
*/

import { useEffect, useMemo, useState } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResRuntime, ResSeed } from '@/domain/entities/runtime'
import { makeCombatGraph } from '@/engine/runtime/combatGraph'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { mkPrepLiveCm } from '@/modules/simulation/model/selectors.ts'
import { mkPrepWork } from '@/engine/pipeline/preparedWorkspace'
import type { SimResult } from '@/engine/pipeline/types'
import { scheduleAfterSettled } from '@/shared/lib/scheduleAfterSettled.ts'

interface EvaluationTargetIn {
  targetRuntime: ResRuntime | null
  targetSeed: ResSeed | null
  targetSelections: Record<string, string | null>
  baseRuntimesById: Record<string, ResRuntime>
  enemy: EnemyProfile
  deferHeavyWork?: boolean
}

export interface EvaluationTarget {
  runtimesById: Record<string, ResRuntime>
  simulation: SimResult | null
}

export function useEvaluationTarget({
  targetRuntime,
  targetSeed,
  targetSelections,
  baseRuntimesById,
  enemy,
  deferHeavyWork = false,
}: EvaluationTargetIn): EvaluationTarget {
  const settleInputs = useMemo(() => [
    targetRuntime,
    targetSeed,
    targetSelections,
    baseRuntimesById,
    enemy,
  ], [targetRuntime, targetSeed, targetSelections, baseRuntimesById, enemy])
  const [settledInputs, setSettledInputs] = useState<readonly unknown[] | null>(
    () => deferHeavyWork ? null : settleInputs,
  )

  /* eslint-disable react-hooks/set-state-in-effect -- this state is the external idle-scheduler boundary. */
  useEffect(() => {
    if (!deferHeavyWork) return undefined

    setSettledInputs(null)
    return scheduleAfterSettled(() => setSettledInputs(settleInputs))
  }, [deferHeavyWork, settleInputs])
  /* eslint-enable react-hooks/set-state-in-effect */

  // check settled input identity during render. an edit invalidates stale
  // preparation before the effect resets the gate.
  const heavyWorkReady = !deferHeavyWork || settledInputs === settleInputs
  const resolvedTargetRuntime = heavyWorkReady ? targetRuntime : null
  const resolvedTargetSeed = heavyWorkReady ? targetSeed : null

  const runtimesById = useMemo(() => resolvedTargetRuntime
    ? makeRuntimeMap(resolvedTargetRuntime, baseRuntimesById)
    : baseRuntimesById,
  [baseRuntimesById, resolvedTargetRuntime])

  const combatGraph = useMemo(() => resolvedTargetRuntime ? makeCombatGraph({
    actRt: resolvedTargetRuntime,
    partRts: runtimesById,
    targetsByRes: { [resolvedTargetRuntime.id]: targetSelections },
  }) : null, [resolvedTargetRuntime, runtimesById, targetSelections])

  const prepWork = useMemo(() => resolvedTargetRuntime && resolvedTargetSeed ? mkPrepWork({
    runtime: resolvedTargetRuntime,
    seed: resolvedTargetSeed,
    enemy,
    prtcRntmById: runtimesById,
    activeTarget: targetSelections,
    combatGraph,
  }) : null, [resolvedTargetRuntime, resolvedTargetSeed, enemy, runtimesById, targetSelections, combatGraph])

  const simulation = useMemo(() => mkPrepLiveCm(prepWork), [prepWork])

  return { runtimesById, simulation }
}
