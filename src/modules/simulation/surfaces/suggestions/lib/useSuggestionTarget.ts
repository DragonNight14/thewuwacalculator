/*
  Author: Runor Ewhro
  description: derives the runtime and simulation used by suggestions for
               a catalog default rotation.
*/

import { useMemo } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { SuggSets } from '@/domain/entities/suggestions.ts'
import { getDefaultRotation } from '@/data/catalog/gameDataService.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { runResSmlt } from '@/engine/pipeline'
import type { SimResult } from '@/engine/pipeline/types.ts'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters.ts'
import { cloneRotationNodes } from '@/domain/entities/inventoryStorage.ts'

export function useSuggestionTarget(
  liveRuntime: ResRuntime,
  liveSimulation: SimResult | null,
  settings: SuggSets,
  enemy: EnemyProfile,
  participants: Record<string, ResRuntime>,
  selectedTargets: Record<string, string | null>,
) {
  const runtime = useMemo(() => {
    const preset = settings.rotationMode
      ? getDefaultRotation(liveRuntime.id)
      : null
    if (!preset) return liveRuntime
    return {
      ...liveRuntime,
      rotation: {
        ...liveRuntime.rotation,
        sequence: cloneRotationNodes(preset.items),
        program: cloneRotationNodes(preset.items),
      },
    }
  }, [liveRuntime, settings.rotationMode])

  const simulation = useMemo(() => {
    if (runtime === liveRuntime) return liveSimulation
    const seed = getResSeedBy(runtime.id)
    return seed ? runResSmlt(runtime, seed, enemy, makeRuntimeMap(runtime, participants), selectedTargets) : null
  }, [runtime, liveRuntime, liveSimulation, enemy, participants, selectedTargets])

  return { runtime, simulation }
}
