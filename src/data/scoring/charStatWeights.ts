/*
  Author: Runor Ewhro
  description: resolves generated, mode-specific echo stat weights while
               preserving the scoring accessors used by simulation surfaces.
*/

import betaArtifact from './generated/charStatWeights.beta.json'
import liveArtifact from './generated/charStatWeights.live.json'
import { getGameDataMode } from '@/data/gameData'

type StatWeights = Record<string, number>

type CharStatWeightArtifact = {
  revision: number
  mode: string
  weights: Record<string, StatWeights>
}

const artifacts = {
  beta: betaArtifact,
  live: liveArtifact,
} satisfies Record<'beta' | 'live', CharStatWeightArtifact>

function currentArtifact(): CharStatWeightArtifact {
  return artifacts[getGameDataMode()]
}

// include the selected data mode so consumers can safely cache derived scores.
export function getWeightSetKey(): string {
  const artifact = currentArtifact()
  return `${artifact.mode}:${artifact.revision}`
}

// get the weight of a single stat key for a given character
export function getWeight(charId: string, key: string): number {
  return currentArtifact().weights[charId]?.[key] ?? 0
}

// get the full stat-weight object for a given character
export function getWeightObj(charId: string): StatWeights {
  return currentArtifact().weights[charId] ?? {}
}
