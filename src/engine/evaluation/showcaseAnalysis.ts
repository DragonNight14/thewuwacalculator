/*
  Author: Runor Ewhro
  description: computes the compact showcase readings without retaining report presentation graphs.
*/
import type { EnemyProfile } from '@/domain/entities/appState'
import type { CombatScenarioId, TeamMemberId } from '@/domain/entities/combatScenario'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { mkPrepWork, runPrepWorkS } from '@/engine/pipeline/preparedWorkspace'
import { makeCombatGraph } from '@/engine/runtime/combatGraph'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { ensureAnchorStoreHydrated, prepareRotationBuildScore } from './report'
import { prepareEchoMainStatScoring } from './echoMainStatProfile'
import { activeMainStatProfile, type EchoMainStatScoreProfile } from './echoScoring'
import { runPrepMainS } from '@/engine/suggestions/mainStat/suggest'

export interface ShowcaseContext {
  runtime: ResRuntime
  runtimesById: Record<string, ResRuntime>
  enemy: EnemyProfile
  selectedTargets: Record<string, string | null>
  graph?: Pick<Parameters<typeof makeCombatGraph>[0], 'memberIdByResonatorId' | 'environmentBuffsByMemberId' | 'environmentTargetModifiers' | 'targetsByRes'>
}
export interface ShowcaseAnalysisInput {
  scenarioId: CombatScenarioId
  memberId: TeamMemberId
  evaluation: ShowcaseContext
  live: ShowcaseContext
  setConds?: SntSetConds
}
export interface ShowcaseAnalysisResult {
  percent: number | null
  userDamage: number | null
  echoProfile: EchoMainStatScoreProfile | null
}
export type ShowcaseAnalysisProgress =
  | { stage: 'damage'; userDamage: number | null }
  | { stage: 'score'; percent: number | null }

function prepare(input: ShowcaseContext) {
  const seed = getResSeedBy(input.runtime.id)
  if (!seed) return null
  const runtimesById = makeRuntimeMap(input.runtime, input.runtimesById)
  const combatGraph = makeCombatGraph({ actRt: input.runtime, partRts: runtimesById, targetsByRes: { [input.runtime.id]: input.selectedTargets }, ...input.graph })
  const work = mkPrepWork({ runtime: input.runtime, seed, enemy: input.enemy, prtcRntmById: runtimesById, activeTarget: input.selectedTargets, combatGraph })
  const simulation = runPrepWorkS(work, { detail: 'summary' })
  return simulation ? { seed, runtimesById, simulation } : null
}

export async function computeShowcaseAnalysis(
  input: ShowcaseAnalysisInput,
  checkCancel?: () => void,
  onProgress?: (progress: ShowcaseAnalysisProgress) => void,
): Promise<ShowcaseAnalysisResult> {
  checkCancel?.()
  // keep the normalized scoring policy separate from the user's live echo context.
  const scoring = prepareRotationBuildScore({
    scenarioId: input.scenarioId, memberId: input.memberId,
    runtime: input.evaluation.runtime, enemy: input.evaluation.enemy,
    runtimesById: makeRuntimeMap(input.evaluation.runtime, input.evaluation.runtimesById),
  })
  const userDamage = scoring?.userDamage ?? null
  onProgress?.({ stage: 'damage', userDamage })
  // damage does not depend on disk hydration, anchor search, or echo grading.
  if (scoring) await ensureAnchorStoreHydrated()
  checkCancel?.()
  const percent = scoring?.calculatePercent(checkCancel) ?? null
  onProgress?.({ stage: 'score', percent })
  checkCancel?.()
  let echoProfile: EchoMainStatScoreProfile | null = null
  if (input.live.runtime.build.echoes.some(Boolean)) {
    const live = prepare(input.live)
    if (live) {
      await prepareEchoMainStatScoring({
        scenarioId: input.scenarioId, memberId: input.memberId, ...input.live,
        seed: live.seed, simulation: live.simulation, setConds: input.setConds,
      }, async (prepared) => { checkCancel?.(); return runPrepMainS(prepared) })
      echoProfile = activeMainStatProfile(input.live.runtime.id) ?? null
    }
  }
  checkCancel?.()
  return { percent, userDamage, echoProfile }
}
