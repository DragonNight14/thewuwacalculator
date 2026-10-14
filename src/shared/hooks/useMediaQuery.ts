/*
  Author: Runor Ewhro
  description: subscribes to a css media query and returns whether it currently
               matches, ssr-safe and updating as the viewport changes.
*/

import { useEffect, useState } from 'react'
import { matchLayoutWidthQuery } from '@/shared/lib/layoutViewport'

function readQuery(query: string): boolean {
  const layoutMatch = matchLayoutWidthQuery(query)
  if (layoutMatch !== null) return layoutMatch
  return window.matchMedia(query).matches
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return readQuery(query)
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }
    const layoutMatch = matchLayoutWidthQuery(query)
    const media = layoutMatch === null ? window.matchMedia(query) : null
    const update = () => setMatches(readQuery(query))
    update()
    if (media) {
      media.addEventListener('change', update)
      return () => media.removeEventListener('change', update)
    }

    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [query])

  return matches
}
