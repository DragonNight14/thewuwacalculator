/*
  Author: Runor Ewhro
  description: identifies the destination runtime for build imports when a resonator has multiple roles.
*/

import type { ResProf } from '@/domain/entities/profile.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { maxRuntimeEffects } from '@/engine/runtime/maxRuntime.ts'
import { maxEchoIfChg } from '@/engine/runtime/sourceStateInit.ts'

export type EchoImportDestination =
  | { kind: 'context'; resonatorId: string }
  | { kind: 'team'; resonatorId: string; slotIndex: number }

export function resolveEchoImportRuntime(
  destination: EchoImportDestination | null,
  contextRuntimes: Record<string, ResRuntime>,
  teamRuntimes: Record<string, ResRuntime>,
): ResRuntime | null {
  if (!destination) return null

  return destination.kind === 'context'
    ? contextRuntimes[destination.resonatorId] ?? null
    : teamRuntimes[destination.resonatorId] ?? null
}

export function mergeEchoImportIntoProfile(
  profile: ResProf,
  runtime: ResRuntime,
  options: { maxEffectsOnInit?: boolean } = {},
): ResProf {
  // a first import supplies progression and equipment, but the card has no
  // effect toggles. initialize those from the resulting build when requested.
  const normalizedRuntime = options.maxEffectsOnInit
    ? maxRuntimeEffects(runtime)
    : maxEchoIfChg(runtime, profile.runtime.build.echoes)
  return {
    ...profile,
    runtime: {
      ...profile.runtime,
      progression: {
        ...profile.runtime.progression,
        level: normalizedRuntime.base.level,
        sequence: normalizedRuntime.base.sequence,
        skillLevels: { ...normalizedRuntime.base.skillLevels },
      },
      build: {
        weapon: { ...normalizedRuntime.build.weapon },
        echoes: [...normalizedRuntime.build.echoes],
      },
      local: {
        ...profile.runtime.local,
        controls: { ...normalizedRuntime.state.controls },
      },
    },
  }
}
