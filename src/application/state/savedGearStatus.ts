/*
  Author: Runor Ewhro
  description: builds reference-keyed signature indexes for saved echo and build
               membership checks without rescanning unchanged libraries.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import {
  getBuildSig,
  getEchoSignature,
  type SavedArtifactLibrary,
  type SavedBuildSnap,
} from '@/domain/entities/inventoryStorage'

const echoIndexes = new WeakMap<SavedArtifactLibrary['echoes'], ReadonlySet<string>>()
const buildIndexes = new WeakMap<SavedArtifactLibrary['builds'], ReadonlySet<string>>()

export function selectSavedEchoSignatures(state: { library: SavedArtifactLibrary }): ReadonlySet<string> {
  const echoes = state.library.echoes
  let index = echoIndexes.get(echoes)
  if (!index) {
    index = new Set(echoes.map((entry) => getEchoSignature(entry.echo)))
    echoIndexes.set(echoes, index)
  }
  return index
}

export function selectSavedBuildSignatures(state: { library: SavedArtifactLibrary }): ReadonlySet<string> {
  const builds = state.library.builds
  let index = buildIndexes.get(builds)
  if (!index) {
    index = new Set(builds.map((entry) => getBuildSig(entry.build)))
    buildIndexes.set(builds, index)
  }
  return index
}

export function isEchoSaved(index: ReadonlySet<string>, echo: EchoInstance | null | undefined): boolean {
  return Boolean(echo && index.has(getEchoSignature(echo)))
}

export function isBuildSaved(index: ReadonlySet<string>, build: SavedBuildSnap): boolean {
  return index.has(getBuildSig(build))
}
