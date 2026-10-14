/*
  Author: Runor Ewhro
  description: keeps rotation column budgets in sync with the layout viewport.
*/

import { useMediaQuery } from '@/shared/hooks/useMediaQuery'
import { statCeiling } from '@/modules/simulation/surfaces/rotation/program-editor/presentation/registerRows'

export function useColumnCeiling(docked: boolean): number {
  const compact = useMediaQuery('(max-width: 1659px)')
  return statCeiling(docked, compact)
}
