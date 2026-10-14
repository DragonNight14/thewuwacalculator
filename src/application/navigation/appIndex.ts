/*
  Author: Runor Ewhro
  description: defines the visible top-level home, simulation, and read navigation hierarchy.
*/

import { APP_NAVIGATION } from '@/shared/lib/appRoutes'
import type { SimulationRoute } from '@/shared/lib/appRoutes'

export type SimulationPageId = SimulationRoute

export interface SimulationPage {
  id: SimulationPageId
  name: string
  scope: string
  to: string
  art: string
  says: string
}

export const SIMULATION_PAGES: SimulationPage[] = [
  {
    id: 'modulation',
    ...APP_NAVIGATION.modulation,
    scope: 'one build',
    art: '/assets/home/catalog.webp',
    says: 'Should i pull S2 or just save?? is R5 on the 4 star Arbiter\'s Back Scrubber Pro Max (ABSPM) actually fine??" No, that weapon is yet to exist, but you can check other weapons out!',
  },
  {
    id: 'showcase',
    ...APP_NAVIGATION.showcase,
    scope: 'one build',
    art: '/assets/home/showcase.webp',
    says: 'Is your build terrible? atrocious even? Yes, it absolutely is but... at least you can make it look prettier..? (˶>⩊<˶)',
  },
  {
    id: 'suggestions',
    ...APP_NAVIGATION.suggestions,
    scope: 'one change',
    art: '/assets/home/optimizer.webp',
    says: 'Which change improves this build most? Compare main stats, Sonata sets, and weapons against the selected damage target.',
  },
  {
    id: 'optimizer',
    ...APP_NAVIGATION.optimizer,
    scope: 'every build',
    art: '/assets/home/optimizer.webp',
    says: 'Erm is this piece with double crit better than my other piece with no crit at all?" Well.. yeah, probably (shocker) but you can\'t be too sure right??',
  },
  {
    id: 'rotation',
    ...APP_NAVIGATION.rotation,
    scope: 'one sequence',
    art: '/assets/home/rotation.webp',
    says: 'Using the power of node types, trees and other computer terms you probably don\'t care about, you can create a pretty super realistic rotation scenario and even compare it against others! The UI for it rocks, i promise.',
  },
]

export interface ReadPage {
  name: string
  to: string
  external?: boolean
}

export const READ_PAGES: ReadPage[] = [
  APP_NAVIGATION.docs,
  APP_NAVIGATION.guides,
  APP_NAVIGATION.changelog,
  APP_NAVIGATION.calibration,
]

export interface AppLink {
  name: string
  to: string
}

export const LINKS: AppLink[] = [
  { name: 'Discord', to: 'https://discord.gg/wNaauhE4uH' },
  { name: 'Ko-fi', to: 'https://ko-fi.com/ssjrunor' },
]

export const REST_ART = '/assets/home/overview.webp'

export interface ArtCredit {
  subject: string
  artist: string
  // canonical source used for artwork attribution.
  source?: string
}

export const ART_CREDITS: Record<string, ArtCredit> = {
  '/assets/home/showcase.webp': { subject: 'Qingxiao', artist: 'r1zen' },
  '/assets/home/rotation.webp': { subject: 'Hiyuki', artist: '鱼鹅BABA', source: 'https://www.pixiv.net/en/artworks/144558419' },
  '/assets/home/arrival.webp': { subject: 'Quiyuan', artist: 'Kuro Games', source: 'https://x.com/Wuthering_Waves/status/1984832844644937910' },
  '/assets/home/optimizer.webp': { subject: 'Chisa and Namipon', artist: 'lxc' },
  '/assets/home/release.webp': { subject: 'Hsin', artist: '若干爪', source: 'https://x.com/ruoganzhua/status/2075434349735137326' },
  '/assets/home/about.webp': { subject: 'Phoebe', artist: '-蒸ZHENG--', source: 'https://x.com/W_zhengZ/status/1875832302112309291' },
  '/assets/home/catalog.webp': { subject: 'Denia', artist: 'HYONEE' },
  '/assets/home/report.webp': { subject: 'Cartethyia', artist: 'RiiKooM', source: 'https://x.com/Rikom03351553/status/1933739261326766541' },
}

export function creditFor(art: string): ArtCredit | null {
  return ART_CREDITS[art] ?? null
}
