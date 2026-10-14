/*
  Author: Runor Ewhro
  description: loads simulation surface components lazily and defines their preload behavior.
*/

import { createRouteChunk } from '@/shared/navigation/routeChunk'
import type { SimulationSurface } from '@/shared/lib/appRoutes'

export const optimizerPane = createRouteChunk(async () => (
  (await import('@/modules/simulation/surfaces/optimizer/Optimizer.tsx')).Optimizer
))

export const buildWorkspacePane = createRouteChunk(async () => (
  (await import('@/modules/simulation/workspace/BuildWorkspaceSurface')).BuildWorkspaceSurface
))

export const suggestionsPane = createRouteChunk(async () => (
  (await import('@/modules/simulation/surfaces/suggestions/results/Page.tsx')).Page
))

export const rotationPane = createRouteChunk(async () => (
  (await import('@/modules/simulation/surfaces/rotation/program-editor/Page.tsx')).ProgramEditor
))

export interface WarmableSurfaceChunk {
  warm: () => Promise<void>
  isWarm: () => boolean
}

export const SIMULATION_SURFACE_CHUNKS: Record<SimulationSurface, WarmableSurfaceChunk[]> = {
  modulation: [buildWorkspacePane],
  optimizer: [buildWorkspacePane, optimizerPane],
  showcase: [buildWorkspacePane],
  suggestions: [buildWorkspacePane, suggestionsPane],
  rotation: [rotationPane],
}
