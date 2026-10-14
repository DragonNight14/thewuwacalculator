/*
  Author: Runor Ewhro
  description: resolves mobile presentation from the shared responsive policy,
               pointer capabilities, and temporary page-local overrides.
*/

import { useSyncExternalStore } from 'react'
import { APP_ROUTES } from '@/shared/lib/appRoutes'
import { RESPONSIVE_MEDIA, RESPONSIVE_POLICY } from '@/shared/responsive/policy'

export type UiMode = 'mobile' | 'desktop'

const PHONE_QUERY = RESPONSIVE_MEDIA.phoneCapability
const MOBILE_ROUTES = new Set<string>(RESPONSIVE_POLICY.mobileRouteIds.flatMap((routeId) => (
  routeId === 'home' ? [APP_ROUTES.home] : []
)))

const listeners = new Set<() => void>()

function isUiMode(value: string | null): value is UiMode {
  return value === 'mobile' || value === 'desktop'
}

// query overrides apply only to this page load and never update the manual pick.
function readPick(): UiMode | null {
  if (typeof window === 'undefined') return null
  const asked = new URLSearchParams(window.location.search).get('ui')
  return isUiMode(asked) ? asked : null
}

let pick = readPick()

function deviceIsPhone(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(PHONE_QUERY).matches
}

export function prefersMobileUi(): boolean {
  return pick ? pick === 'mobile' : deviceIsPhone()
}

// null clears the manual override and restores capability-based resolution.
export function setUiMode(mode: UiMode | null) {
  pick = mode
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null
  media?.addEventListener('change', listener)
  return () => {
    listeners.delete(listener)
    media?.removeEventListener('change', listener)
  }
}

export function useMobileUi(): boolean {
  return useSyncExternalStore(subscribe, prefersMobileUi, () => false)
}

export function hasMobileRoute(pathname: string): boolean {
  return MOBILE_ROUTES.has(pathname)
}
