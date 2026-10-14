/*
  Author: Runor Ewhro
  description: coordinates mobile home plate selection, deferred art changes,
               coverage data, and work-drawer state.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AxLink } from '@/shared/navigation/useNavX'
import { useRtChrmMen } from '@/application/context-menu/routeMenuContext'
import { APP_CONDITION } from '@/data/content/appStatus'
import { getWhatsNewEntries } from '@/data/content/changelogEntries'
import { useAppSnapshot } from '@/modules/home/model/useAppSnapshot'
import { useCoverage } from '@/modules/home/model/useCoverage'
import { loadArrivals } from '@/modules/home/model/arrivals'
import type { Arrivals } from '@/modules/home/model/arrivals'
import { ARRIVAL_ART, RELEASE_ART, REPORT_ART } from '@/modules/home/model/homeArt'
import { AlsoPlate, DevPlate, FeedPlate, NewsPlate, ResonatorPlate } from '@/modules/home/mobile/MobilePlates'
import { WorkDrawer } from '@/modules/home/mobile/WorkDrawer'
import Thewuwacalculator from '@/assets/thewuwacalculator.svg?react'

// delay art commits until selection settles so intermediate requests collapse.
const GROUND_WAIT = 280

interface Plate {
  key: string
  label: string
  art: string
  ink?: string
  body: ReactNode
}

const ENTRIES = getWhatsNewEntries()

export function MobileHomePage() {
  const snapshot = useAppSnapshot()
  const coverage = useCoverage()
  const rtChrmMenu = useRtChrmMen()

  // undefined is pending; null is a completed unavailable result.
  const [arrivals, setArrivals] = useState<Arrivals | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    void loadArrivals().then((found) => { if (live) setArrivals(found) })
    return () => { live = false }
  }, [])

  const plates = useMemo<Plate[]>(() => {
    const list: Plate[] = [
      { key: 'dev', label: 'From the dev', art: REPORT_ART, body: <DevPlate coverage={coverage} /> },
    ]
    if (arrivals) {
      arrivals.resonators.forEach((who) => list.push({
        key: `res-${who.id}`,
        label: who.name,
        art: ARRIVAL_ART,
        ink: who.colour,
        body: <ResonatorPlate who={who} />,
      }))
      list.push({ key: 'also', label: 'Also in this patch', art: ARRIVAL_ART, body: <AlsoPlate arrivals={arrivals} /> })
    } else {
      list.push({ key: 'feed', label: 'Just arrived', art: ARRIVAL_ART, body: <FeedPlate missing={arrivals === null} /> })
    }
    if (ENTRIES.length > 0) {
      list.push({ key: 'news', label: 'What’s new', art: RELEASE_ART, body: <NewsPlate entries={ENTRIES} /> })
    }
    return list
  }, [arrivals, coverage])

  const rail = useRef<HTMLDivElement | null>(null)
  const [at, setAt] = useState(0)

  const scan = useCallback(() => {
    const root = rail.current
    if (!root) return
    const middle = root.scrollLeft + root.clientWidth / 2
    let best = 0
    let gap = Infinity
    Array.from(root.children).forEach((node, index) => {
      const plate = node as HTMLElement
      const off = Math.abs(plate.offsetLeft + plate.offsetWidth / 2 - middle)
      if (off < gap) { gap = off; best = index }
    })
    setAt(best)
  }, [])

  useEffect(() => {
    const root = rail.current
    if (!root) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; scan() })
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      root.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [scan])

  const goTo = useCallback((index: number) => {
    const plate = rail.current?.children[index] as HTMLElement | undefined
    plate?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [])

  const wanted = plates[Math.min(at, plates.length - 1)]?.art ?? REPORT_ART
  const [ground, setGround] = useState(wanted)
  useEffect(() => {
    if (wanted === ground) return
    const timer = window.setTimeout(() => setGround(wanted), GROUND_WAIT)
    return () => window.clearTimeout(timer)
  }, [ground, wanted])

  const arts = useMemo(() => [...new Set(plates.map((plate) => plate.art))], [plates])

  return (
    <div className="mh">
      <div className="mh-ground" aria-hidden="true">
        {arts.map((art) => <img className={art === ground ? 'is-on' : undefined} src={art} alt="" key={art} />)}
      </div>

      <header className="mh-head">
        <AxLink className="mh-mark" to="/">
          <Thewuwacalculator className="mh-mark__glyph" aria-hidden="true" />
          <span>thewuwa<i>calculator</i></span>
        </AxLink>
        <button
          type="button"
          className="mh-stamp-btn"
          onClick={() => rtChrmMenu.actions.openStatus()}
          aria-label={`App status: ${APP_CONDITION.label}, patch ${APP_CONDITION.patch}`}
        >
          <i className={`mh-dot${APP_CONDITION.ok ? '' : ' is-warn'}`} aria-hidden="true" />
          {APP_CONDITION.label} <b>v{APP_CONDITION.patch}</b>
        </button>
      </header>

      <div className="mh-rail" ref={rail}>
        {plates.map((plate) => (
          <article
            className="mh-plate"
            style={plate.ink ? { '--mh-ink': plate.ink } as never : undefined}
            aria-label={plate.label}
            key={plate.key}
          >
            {plate.body}
          </article>
        ))}
      </div>

      <nav className="mh-pager" aria-label="Home sections">
        {plates.map((plate, index) => (
          <button
            type="button"
            className={index === at ? 'is-on' : undefined}
            aria-label={plate.label}
            aria-current={index === at ? 'true' : undefined}
            onClick={() => goTo(index)}
            key={plate.key}
          >
            <i className="mh-spark" aria-hidden="true" />
          </button>
        ))}
      </nav>

      <WorkDrawer snapshot={snapshot} />
    </div>
  )
}
