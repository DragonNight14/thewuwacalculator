/*
  Author: Runor Ewhro
  description: provides the matched simulation surface through the route handle.
*/

import { useMatches } from 'react-router-dom'
import { SIMULATION_SURFACES } from '@/shared/lib/appRoutes'
import type { SimulationSurface } from '@/shared/lib/appRoutes'

export interface SimulationSurfaceHandle {
  surface: SimulationSurface
}

function isSurfaceHandle(handle: unknown): handle is SimulationSurfaceHandle {
  return typeof handle === 'object' && handle !== null
    && (handle as SimulationSurfaceHandle).surface in SIMULATION_SURFACES
}

export function useSimulationSurface(): SimulationSurface | null {
  const handle = useMatches().map((match) => match.handle).find(isSurfaceHandle)
  return handle?.surface ?? null
}
