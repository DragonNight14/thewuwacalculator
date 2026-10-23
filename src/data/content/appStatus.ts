/*
  Author: Runor Ewhro
  description: defines canonical application status, coverage, source, and
               wallpaper metadata consumed by chrome and reporting surfaces.
*/

import { CURRENT_VERSION } from '@/shared/lib/appMetadata'

export type AppState = 'stable' | 'degraded' | 'wip'
export type CoverageKey = 'resonators' | 'weapons' | 'echoes' | 'enemies'

export interface CoverageDomain {
  key: CoverageKey
  title: string
  status: 'ok' | 'down'
  /** explanation shown only when this domain is unavailable. */
  note: string
}

export const STATUS_DATA = {
  lastUpdated: '23/10/2026',

  wallpaper: {
    src: '/assets/app/phoebeW.webp',
    pos: '62% 42%',
    dir: '100deg',
  } as { src: string; pos: string; dir: string } | null,
  overallState: 'stable' as AppState,
  patchVersion: CURRENT_VERSION,
  dataSources: [
    { label: 'encore.moe', href: 'https://encore.moe/new?lang=en' },
    { label: 'nanoka.cc', href: 'https://ww.nanoka.cc/' },
  ],
  notes: [
    'hello my lovelies~! ٩(ˊᗜˋ*)و ♡',
    'i fixed some bugs and added some optimizations to the optimizer and suggestions systems. you can see more in the changelog... i\'m tired.',
    '3.8.1 beta is available, i\'ll work on getting it\'s data on here.',
    'i will also update the docs for the scoring and optimization engine... later.',
  ],
  // consumers join these status records with live catalog counts by key.
  coverage: [
    { key: 'resonators', title: 'Resonators', status: 'ok', note: '' },
    { key: 'weapons',    title: 'Weapons',    status: 'ok', note: '' },
    { key: 'echoes',     title: 'Echoes',     status: 'ok', note: '' },
    { key: 'enemies',    title: 'Enemies',    status: 'ok', note: '' },
  ] as CoverageDomain[],
  recentChanges: [
    'optimizations and bug fixes to searcher systems..',
  ],

  knownIssues: [] as string[]
}

export const STATE_LABELS = {
  stable:   'NOMINAL',
  degraded: 'DEGRADED',
  wip:      'IN PROGRESS',
} as const

// derive the compact chrome status from the same canonical report state.
export const APP_CONDITION = {
  ok: STATUS_DATA.overallState === 'stable',
  label: STATE_LABELS[STATUS_DATA.overallState],
  patch: STATUS_DATA.patchVersion,
} as const
