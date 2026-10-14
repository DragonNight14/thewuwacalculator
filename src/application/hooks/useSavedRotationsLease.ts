/*
  Author: Runor Ewhro
  description: retains saved scenario snapshots during active leases and delays final eviction.
*/

import { useEffect } from 'react'
import { useAppStore } from '@/application/state'

export function useSavedRotationsLease(active = true): void {
  const acquire = useAppStore((state) => state.acquireSavedRotationsLease)

  useEffect(() => {
    if (!active) return undefined
    return acquire()
  }, [acquire, active])
}
