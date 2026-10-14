/*
  Author: Runor Ewhro
  description: protects the home, read, and simulation hierarchy together with
               the redirects for retired routes.
*/

import { describe, expect, it } from 'vitest'
import {
  APP_NAVIGATION,
  APP_ROUTES,
  LEGACY_CALCULATOR_ALIAS,
  LEGACY_PROGRESSION_ALIAS,
  SIMULATION_ROUTES,
  isLegacySimulationRoute,
  isPersistentWorkspaceRoute,
  isSimulationRoute,
  isSimulationSurfaceRoute,
  resolveLegacyRoute,
  surfaceAt,
} from '@/shared/lib/appRoutes'

describe('simulation route contract', () => {
  it('recognizes every canonical simulation tool', () => {
    expect(Object.values(SIMULATION_ROUTES).every(isSimulationRoute)).toBe(true)
    expect(isSimulationSurfaceRoute('/modulation', 'modulation')).toBe(true)
    expect(isSimulationSurfaceRoute('/rotation', 'rotation')).toBe(true)
    expect(isSimulationSurfaceRoute('/showcase', 'showcase')).toBe(true)
    expect(isSimulationSurfaceRoute('/optimizer', 'optimizer')).toBe(true)
  })

  it('keeps retired routes out of canonical surface matching', () => {
    expect(isLegacySimulationRoute(LEGACY_CALCULATOR_ALIAS)).toBe(true)
    expect(isLegacySimulationRoute('/legacy-optimizer')).toBe(false)
    expect(isSimulationSurfaceRoute('/benchmark', 'modulation')).toBe(false)
    expect(isSimulationSurfaceRoute('/calculator', 'modulation')).toBe(false)
  })

  it('maps compatibility URLs to their intended destination', () => {
    expect(resolveLegacyRoute('/home')).toBe('/')
    expect(resolveLegacyRoute(LEGACY_PROGRESSION_ALIAS)).toBe('/modulation')
    expect(resolveLegacyRoute('/calculator/optimizer')).toBe('/optimizer')
    expect(resolveLegacyRoute('/calculator/benchmark/report')).toBe('/modulation/report')
    expect(resolveLegacyRoute('/calculator/rotation')).toBe('/rotation')
    expect(resolveLegacyRoute(LEGACY_CALCULATOR_ALIAS)).toBe('/modulation')
    expect(resolveLegacyRoute('/legacy-optimizer')).toBeNull()
  })

  it('keeps the shared workspace mounted across its three canonical tools', () => {
    expect([
      SIMULATION_ROUTES.modulation,
      SIMULATION_ROUTES.optimizer,
      SIMULATION_ROUTES.showcase,
    ].every(isPersistentWorkspaceRoute)).toBe(true)
    expect(isPersistentWorkspaceRoute(SIMULATION_ROUTES.rotation)).toBe(false)
    expect(isPersistentWorkspaceRoute(LEGACY_CALCULATOR_ALIAS)).toBe(false)
  })
})

describe('application navigation contract', () => {
  it('points every authored destination at a declared route', () => {
    const declared = new Set<string>([
      ...Object.values(APP_ROUTES),
      ...Object.values(SIMULATION_ROUTES),
    ])

    expect(Object.values(APP_NAVIGATION).every(({ to }) => declared.has(to))).toBe(true)
  })

  it('resolves a surface with the router\'s own matching, trailing slash included', () => {
    expect(surfaceAt(SIMULATION_ROUTES.modulation)).toBe('modulation')
    expect(surfaceAt(`${SIMULATION_ROUTES.modulation}/`)).toBe('modulation')
    expect(surfaceAt('/legacy-optimizer')).toBeNull()
    expect(surfaceAt(`${SIMULATION_ROUTES.modulation}/report`)).toBeNull()
    expect(surfaceAt(APP_ROUTES.guides)).toBeNull()
    expect(isPersistentWorkspaceRoute(`${SIMULATION_ROUTES.optimizer}/`)).toBe(true)
  })
})
