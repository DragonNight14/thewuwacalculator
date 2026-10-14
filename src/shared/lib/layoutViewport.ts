/*
  Author: Runor Ewhro
  description: exposes the app's minimum layout width so JavaScript layout
               decisions match the document's css width floor.
*/

import { RESPONSIVE_POLICY } from '@/shared/responsive/policy'

export const APP_LAYOUT_MIN_WIDTH = RESPONSIVE_POLICY.layoutMinWidthPx

const WIDTH_QUERY = /^\(\s*(min|max)-width\s*:\s*([0-9.]+)(px|r?em)\s*\)$/i

export function layoutViewportWidth(): number {
  if (typeof window === 'undefined') return APP_LAYOUT_MIN_WIDTH
  return Math.max(window.innerWidth, APP_LAYOUT_MIN_WIDTH)
}

export function matchLayoutWidthQuery(query: string): boolean | null {
  const match = WIDTH_QUERY.exec(query)
  if (!match) return null

  const amount = Number(match[2])
  const boundary = match[3].toLowerCase() === 'px' ? amount : amount * 16
  return match[1].toLowerCase() === 'min'
    ? layoutViewportWidth() >= boundary
    : layoutViewportWidth() <= boundary
}
