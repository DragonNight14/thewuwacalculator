/*
  Author: Runor Ewhro
  description: emits at most one local-day greeting for a persisted player identity.
*/

import { useEffect } from 'react'
import { useAppStore } from '@/application/state'
import { useTstStr } from '@/shared/util/toastStore.ts'

const DLYNTCSTORE = 'seen-daily-notice'

// the local calendar day, which is what "daily" means to the person reading it
function todayKey(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function DlyNtc() {
  const playerId = useAppStore((state) => state.ui.preferences.playerId)
  const showToast = useTstStr((state) => state.show)
  const dismiss = useTstStr((state) => state.dismiss)

  useEffect(() => {
    if (!playerId) return

    const day = todayKey()
    if (localStorage.getItem(DLYNTCSTORE) === day) {
      return
    }

    /*
      delay the notice until after mount. StrictMode can tear down and remount
      in the same commit; cleanup cancels the first notice before it enters the
      store. this avoids overlapping enter and dismissal animations.

      mark the day only when the notice is shown.
    */
    let id: string | null = null
    const timer = setTimeout(() => {
      localStorage.setItem(DLYNTCSTORE, day)

      id = showToast({
        content: `Welcome back, ${playerId}~`,
        variant: 'default',
        duration: 8000,
      })
    })

    // taking the notice off the tree takes its toast with it, so a slab never
    // outlives the mount that raised it
    return () => {
      clearTimeout(timer)
      if (id) dismiss(id)
    }
  }, [dismiss, playerId, showToast])

  return null
}
