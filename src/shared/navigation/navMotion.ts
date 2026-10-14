/*
  Author: Runor Ewhro
  description: resolves whether route changes may use view transitions under current motion preferences.
*/

import { APP_ROUTES, SIMULATION_ROUTES } from '@/shared/lib/appRoutes'

// the app's own motion switch decides this, not the browser's, because the
// setting is the one the player turned off
export function motionAllowed(): boolean {
  if (typeof document === 'undefined') return false
  if (typeof document.startViewTransition !== 'function') return false
  return !document.documentElement.classList.contains('reduce-animation')
}

// these routes share the roster, rail, and band in the same positions. mark a
// move between them with one dissolve to keep those elements visually stable.
const SAME_ROOM: string[][] = [
  [
    SIMULATION_ROUTES.modulation,
    SIMULATION_ROUTES.optimizer,
    SIMULATION_ROUTES.showcase,
    SIMULATION_ROUTES.suggestions,
  ],
]

const DISSOLVE = 'ax-dissolve'

// the class applies only during a transition and expires after the move.
const DISSOLVE_HELD = 700

let dropAt = 0

function sameRoom(from: string, to: string): boolean {
  if (from === to) return false
  return SAME_ROOM.some((room) => room.includes(from) && room.includes(to))
}

/*
  home uses a wider, opaque indicator; other routes animate it on interaction.
  start the padding and opacity transition on click because destination setup
  can block animation frames after the route commits. initial loads and history
  navigation synchronize the indicator from the destination route.
*/
const FRONT = 'ax-front'

export function setFrontDoor(to: string): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle(FRONT, to === APP_ROUTES.home)
}

// armed on the move itself, because which move it is cannot be read from either
// page: the page being left does not know where it is going
export function armMove(from: string, to: string): void {
  if (typeof document === 'undefined') return

  setFrontDoor(to)

  const root = document.documentElement
  window.clearTimeout(dropAt)

  if (!sameRoom(from, to)) {
    root.classList.remove(DISSOLVE)
    return
  }

  root.classList.add(DISSOLVE)
  dropAt = window.setTimeout(() => root.classList.remove(DISSOLVE), DISSOLVE_HELD)
}
