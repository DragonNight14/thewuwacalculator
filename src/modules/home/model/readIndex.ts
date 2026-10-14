/*
  Author: Runor Ewhro
  description: builds lazy home metadata for read routes without importing
               their full content into the home chunk.
*/

import { useEffect, useState } from 'react'
import { useAppStore } from '@/application/state'
import { READ_PAGES } from '@/application/navigation/appIndex'
import { ltstCurChngE } from '@/data/content/changelogEntries'
import { THEME_LABELS } from '@/domain/entities/themes'
import { APP_ROUTES } from '@/shared/lib/appRoutes'

export interface ReadStop {
  name: string
  to: string
  // optional compact metric and unit label for route metadata with a count.
  figure: string | null
  says: string | null
}

interface Counts {
  docs: number
  guides: number
}

let counted: Promise<Counts> | null = null

function countReading(): Promise<Counts> {
  counted ??= Promise.all([
    import('@/data/content/docsContent'),
    import('@/data/content/guidesContent'),
  ]).then(([docs, guides]) => ({ docs: docs.docTopics.length, guides: guides.gdCtgr.length }))
  return counted
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

export function useReadIndex(): ReadStop[] {
  const [counts, setCounts] = useState<Counts | null>(null)
  const theme = useAppStore((state) => {
    const { ui } = state
    if (ui.theme === 'background') return ui.backgroundVariant
    return ui.theme === 'light' ? ui.lightVariant : ui.darkVariant
  })

  useEffect(() => {
    let live = true
    void countReading().then((found) => { if (live) setCounts(found) }).catch(() => {})
    return () => { live = false }
  }, [])

  const latest = ltstCurChngE?.date ?? null

  return READ_PAGES.map((page) => {
    switch (page.to) {
      case APP_ROUTES.docs:
        return { ...page, figure: counts ? String(counts.docs) : null, says: counts ? plural(counts.docs, 'topic') : null }
      case APP_ROUTES.guides:
        return { ...page, figure: counts ? String(counts.guides) : null, says: counts ? plural(counts.guides, 'chapter') : null }
      case APP_ROUTES.changelog:
        return { ...page, figure: latest?.slice(0, 5) ?? null, says: latest ? `latest update ${latest}` : null }
      case APP_ROUTES.calibration:
        return { ...page, figure: THEME_LABELS[theme], says: `wearing ${THEME_LABELS[theme]}` }
      default:
        return { ...page, figure: null, says: null }
    }
  })
}
