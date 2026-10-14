/*
  Author: Runor Ewhro
  description: where each page was left. a push arrives at the top of the new
               page, and a step back arrives exactly where it was read from, so
               the transition never animates a page into a scroll position it
               did not have.
*/

import { useEffect, useLayoutEffect } from 'react'
import type { RefObject } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// keep at most 40 scroll history entries; evict the oldest on overflow.
const KEPT = 40
const left = new Map<string, number>()

function remember(key: string, top: number) {
  left.delete(key)
  left.set(key, top)
  while (left.size > KEPT) {
    const oldest = left.keys().next().value
    if (oldest === undefined) break
    left.delete(oldest)
  }
}

export function useMainScroll(ref: RefObject<HTMLElement | null>): void {
  const location = useLocation()
  const navigationType = useNavigationType()
  const { key } = location

  useLayoutEffect(() => {
    const surface = ref.current
    if (!surface) return

    const stored = left.get(key)
    surface.scrollTop = navigationType === 'POP' && stored !== undefined ? stored : 0
  }, [key, navigationType, ref])

  useEffect(() => {
    const surface = ref.current
    if (!surface) return

    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        remember(key, surface.scrollTop)
      })
    }

    surface.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      surface.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [key, ref])
}
