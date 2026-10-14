/*
  Author: Runor Ewhro
  description: resolves generated colors for bundled portraits and delegates
               custom-image sampling to the persistent reference cache.
*/

import surfaces from '@/data/gameData/portraitSurfaces.json'
import { readCachedPortraitSurface } from '@/application/media/portraitSurfaceCache.ts'
import { DEFAULT_PORTRAIT_SURFACE } from '@/shared/lib/portraitSurface.ts'
export { DEFAULT_PORTRAIT_SURFACE, inkForSurface, surfaceFromPortraitPixels } from '@/shared/lib/portraitSurface.ts'

export function getPortraitSource(card: HTMLElement | null): string | null {
  if (!card) return null
  for (const selector of ['img.is-override', 'img.spine-setup', 'img.wk-portrait-img']) {
    const image = card.querySelector<HTMLImageElement>(`.wk-portrait-figure ${selector}`)
    if (image?.naturalWidth) return image.currentSrc || image.src || null
  }
  return null
}

export function readPortraitSurface(source: string, imageRef?: string | null): Promise<string> {
  const url = new URL(source, window.location.href)
  if (url.origin === window.location.origin && url.pathname.startsWith('/assets/game/')) {
    // missing/new bundled art uses the base until its metadata is generated;
    // bundled portraits never require runtime pixel sampling.
    return Promise.resolve((surfaces as Record<string, string>)[url.pathname] ?? DEFAULT_PORTRAIT_SURFACE)
  }
  return readCachedPortraitSurface(imageRef ?? source, source)
}
