/*
  Author: Runor Ewhro
  description: reads the live column count of a css grid for row-based entrance
               staggering. Auto-fill/auto-fit column counts change with viewport
               width and cannot be determined from css alone.
*/

import { useCallback, useRef, useState } from 'react'
import type { RefCallback } from 'react'

export function useGridColumns(): [RefCallback<HTMLElement>, number] {
  const [columns, setColumns] = useState(1)
  const observerRef = useRef<ResizeObserver | null>(null)

  const setRef = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null

    if (!el) {
      return
    }

    const measure = () => {
      const trackCount = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length
      setColumns(trackCount > 0 ? trackCount : 1)
    }

    // the observer delivers a first reading of its own, so the count never costs
    // a computed-style read inside the commit that mounted the grid.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observerRef.current = observer
  }, [])

  return [setRef, columns]
}
