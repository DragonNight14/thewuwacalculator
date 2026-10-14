/*
  Author: Runor Ewhro
  description: computes the current combat sheet without rotation execution or scoring.
*/
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeCombatGraph } from '@/engine/runtime/combatGraph'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext'
import type { ShowcaseContext } from './showcaseAnalysis'

export function computeShowcaseStats(input: ShowcaseContext) {
  const seed = getResSeedBy(input.runtime.id)
  if (!seed) return null
  const graph = makeCombatGraph({
    actRt: input.runtime,
    activeSeed: seed,
    partRts: makeRuntimeMap(input.runtime, input.runtimesById),
    targetsByRes: { [input.runtime.id]: input.selectedTargets },
    ...input.graph,
  })
  return makeCombatEnv({ graph, targetSlotId: graph.activeSlotId, enemy: input.enemy }).finalStats
}
