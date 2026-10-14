/*
  Author: Runor Ewhro
  description: tracks pending navigation and enforces its delay, minimum
               visible duration, and failure ceiling.
*/

import { create } from 'zustand'

// keep this synchronized with --hold-after. css sets the delay because module
// evaluation can block the main thread and prevent a javascript timer firing.
const SAY_AFTER = 120
// once visible, progress remains mounted for at least this interval.
const SAY_FOR = 340

// releases progress if preloading or rendering never reaches the paint signal.
const HOLD_CEILING = 12000

interface NavProgress {
  running: boolean
  to: string | null
  begin: (to: string) => void
  end: () => void
}

export const useNavPrgrs = create<NavProgress>((set, get) => ({
  running: false,
  to: null,
  begin: (to) => {
    window.clearTimeout(hideTimer)
    window.clearTimeout(ceilingTimer)
    beganAt = performance.now()
    ceilingTimer = window.setTimeout(() => get().end(), HOLD_CEILING)
    set({ to, running: true })
  },
  end: () => {
    window.clearTimeout(ceilingTimer)

    // clear the pending destination at paint time, but retain the running state
    // until the minimum visible interval has elapsed.
    if (get().to !== null) set({ to: null })
    if (!get().running) return

    const stood = performance.now() - beganAt
    window.clearTimeout(hideTimer)

    // css has not exposed progress yet, so no minimum visible interval is due.
    if (stood < SAY_AFTER) {
      set({ running: false })
      return
    }

    hideTimer = window.setTimeout(
      () => set({ running: false }),
      Math.max(SAY_AFTER + SAY_FOR - stood, 0),
    )
  },
}))

let hideTimer = 0
let ceilingTimer = 0
let beganAt = 0
