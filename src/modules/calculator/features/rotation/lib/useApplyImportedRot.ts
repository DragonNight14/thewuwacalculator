/*
  Author: Runor Ewhro
  Description: Applies imported saved rotations by materializing required team
               runtimes before switching active resonator and writing rotation state.
*/

import { useCallback } from 'react'
import type { InvRotEnt } from '@/domain/entities/inventoryStorage.ts'
import { cloneRotNds } from '@/domain/entities/inventoryStorage.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { selActResId } from '@/domain/state/selectors.ts'
import { seedRsntById } from '@/modules/calculator/features/resonator/lib/seedData.ts'

export function useApplyImportedRot() {
  const actResId = useAppStore(selActResId)
  const swtcToRes = useAppStore((state) => state.swRes)
  const ensTeamMemRt = useAppStore((state) => state.ensTeamRt)
  const updResRt = useAppStore((state) => state.updResRt)
  const loadResProf = useAppStore((state) => state.loadResProf)

  return useCallback((entry: InvRotEnt) => {
    if (entry.mode === 'team' && entry.team) {
      for (const memberId of entry.team) {
        if (!memberId) continue
        const memberSeed = seedRsntById[memberId]
        if (memberSeed && memberId !== entry.resonatorId) {
          ensTeamMemRt(memberSeed)
        }
      }
    }

    if (entry.resonatorId !== actResId) {
      swtcToRes(entry.resonatorId)
    }

    if (entry.snapshot) {
      loadResProf(entry.snapshot)
    }

    updResRt(entry.resonatorId, (prev: ResRuntime): ResRuntime => ({
      ...prev,
      build: {
        ...prev.build,
        team:
          entry.mode === 'team' && entry.team
            ? [...entry.team] as ResRuntime['build']['team']
            : prev.build.team,
      },
      rotation: {
        ...prev.rotation,
        view: entry.mode,
        ...(entry.mode === 'team'
          ? { teamItems: cloneRotNds(entry.items) }
          : { personalItems: cloneRotNds(entry.items) }),
      },
    }))
  }, [actResId, ensTeamMemRt, loadResProf, swtcToRes, updResRt])
}
