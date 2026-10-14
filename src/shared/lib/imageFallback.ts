/*
  Author: Runor Ewhro
  description: shared image fallback handlers for simulation and read ui
               so repeated onerror helpers do not live inside features.
*/

import type { SyntheticEvent as SyntVnt } from 'react'

export const DEF_ICON_SRC = '/assets/game/default.webp'
export const DEF_ENEMY_SRC = '/assets/game/enemies/icons/default.webp'

// swap a broken image to a stable fallback asset
export function swapMgToFllb(
  event: SyntVnt<HTMLImageElement>,
  fallbackSrc: string,
) {
  const image = event.currentTarget
  if (image.src.endsWith(fallbackSrc)) {
    return
  }

  image.removeAttribute('srcset')
  image.src = fallbackSrc
}

// use the shared default icon for generic entity images
export function withDefIconM(event: SyntVnt<HTMLImageElement>) {
  swapMgToFllb(event, DEF_ICON_SRC)
}

// img onerror handler that swaps broken weapon icons to the shared default image
export function withDefWpnMg(event: SyntVnt<HTMLImageElement>) {
  swapMgToFllb(event, DEF_ICON_SRC)
}

// img onerror handler for echo icons
export function withDefEchoMg(event: SyntVnt<HTMLImageElement>) {
  swapMgToFllb(event, DEF_ICON_SRC)
}

// picker grids use shared display variants, with canonical art as their first fallback.
export function withPickerImageFallback(event: SyntVnt<HTMLImageElement>) {
  const image = event.currentTarget
  const authored = image.dataset.fullSrc
  if (authored && !image.src.endsWith(authored)) {
    image.removeAttribute('srcset')
    image.src = authored
    return
  }

  swapMgToFllb(event, DEF_ICON_SRC)
}

// img onerror handler for resonator profiles
export function withDefResMg(event: SyntVnt<HTMLImageElement>) {
  swapMgToFllb(event, DEF_ICON_SRC)
}

// img onerror handler for enemy icons
export function withDefEnmyMg(event: SyntVnt<HTMLImageElement>) {
  swapMgToFllb(event, DEF_ENEMY_SRC)
}

// hide images entirely when the ui should collapse to text-only fallback
export function hideBrknMg(event: SyntVnt<HTMLImageElement>) {
  event.currentTarget.style.display = 'none'
}
