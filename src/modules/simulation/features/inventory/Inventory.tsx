/*
  Author: Runor Ewhro
  description: lazy-loads the inventory layer and keeps the global loader active
               until the opened modal has committed.
*/

import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useInventoryUiStore } from '@/application/state/inventoryUiStore'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay.tsx'

const LazyInventoryLayer = lazy(async () => ({
  default: (await import('@/modules/simulation/features/inventory/InventoryLayer.tsx')).InvLyr,
}))

export function Inventory() {
  const invHasMntd = useInventoryUiStore((state) => state.mounted)
  const invOpen = useInventoryUiStore((state) => state.open)
  const [invReady, setInvReady] = useState(false)

  useEffect(() => {
    if (!invOpen) {
      // each opening must wait for a new modal commit before releasing the loader.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInvReady(false)
    }
  }, [invOpen])

  const markInvReady = useCallback(() => {
    setInvReady(true)
  }, [])

  if (!invHasMntd) {
    return null
  }

  return (
    <>
      <Suspense fallback={null}>
        <LazyInventoryLayer onReady={markInvReady} />
      </Suspense>
      {invOpen && !invReady ? <AppLdrVrly mode="scrim" text="Loading inventory..." /> : null}
    </>
  )
}
