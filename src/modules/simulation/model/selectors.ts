/*
  Author: Runor Ewhro
  description: chooses the correct live simulation path for the active
               resonator, using an existing combat graph when possible and
               falling back to a standalone resonator simulation otherwise.
*/

import { runCmbtGrphS, runResSmlt } from '@/engine/pipeline'
import type { ResSeed, ResRuntime } from '@/domain/entities/runtime'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { CombatGraph } from '@/domain/entities/combatGraph'
import {
  mkPrepWork,
  runPrepWorkS,
  type PrepWork,
} from '@/engine/pipeline/preparedWorkspace'
import type {
  RunDetail,
} from '@/engine/rotation/execute'
import type { RotationNode } from '@/domain/gameData/contracts'
import type { SimResult } from '@/engine/pipeline/types'

interface LiveSimulationOptions {
  sequence?: RotationNode[]
  program?: RotationNode[]
  detail?: RunDetail
}

export function mkPrepLiveCm(
  prepWork: PrepWork | null,
  options: LiveSimulationOptions = {},
) {
  if (!prepWork) {
    return null
  }

  return runPrepWorkS(prepWork, options)
}

let liveRunCch: { prepWork: PrepWork; value: SimResult | null } | null = null

/*
  the default live run, held against the prepared workspace it came from. the
  the results pane and toolbar summary share one pipeline result. cache the
  simulation across both readers.
*/
export function selLiveRun(prepWork: PrepWork | null): SimResult | null {
  if (!prepWork) {
    return null
  }

  if (liveRunCch && liveRunCch.prepWork === prepWork) {
    return liveRunCch.value
  }

  const value = runPrepWorkS(prepWork)
  liveRunCch = { prepWork, value }
  return value
}

// build the current live computation result for simulation tools.
// returns null when the active runtime or seed is missing
export function mkLiveCmpt(
  runtime: ResRuntime | null,
  seed: ResSeed | null,
  enemy: EnemyProfile,
  runtimesById: Record<string, ResRuntime> = {},
  graph: CombatGraph | null = null,
  selTrgtByOwn: Record<string, string | null> = {},
  options: LiveSimulationOptions = {},
) {
  if (!runtime || !seed) return null

  const prepWork = mkPrepWork({
    runtime,
    seed,
    enemy,
    prtcRntmById: runtimesById,
    activeTarget: selTrgtByOwn,
    combatGraph: graph,
  })

  const prepSmlt = runPrepWorkS(prepWork, options)
  if (prepSmlt) {
    // the prepared workspace path already supports simulation of graph-aware and
    // standalone cases, so prefer it whenever it can materialize a result.
    return prepSmlt
  }

  // if we already have a combat graph whose active participant matches
  // this runtime, reuse the graph-based simulation path so all participant
  // interactions and graph state stay consistent
  if (graph?.participants.active?.resonatorId === runtime.id) {
    return runCmbtGrphS(graph, 'active', seed, enemy, options)
  }

  // otherwise simulate directly from the runtime plus any linked teammate runtimes
  return runResSmlt(runtime, seed, enemy, runtimesById, selTrgtByOwn, options)
}
