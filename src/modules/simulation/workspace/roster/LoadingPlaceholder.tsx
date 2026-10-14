/*
  Author: Runor Ewhro
  description: preserves roster slot and scroll geometry while the lazy roster
               chunk loads, then transfers the retained offset to its owner.
*/

import { Fragment, useLayoutEffect, useMemo, useRef } from 'react'
import { UsersRound } from 'lucide-react'
import { useAppStore, selContextResonatorId } from '@/application/state'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { DisplayImage } from '@/shared/ui/DisplayImage'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import type { CssVars } from '@/modules/simulation/workspace/ui.tsx'
import { groupByAttribute, makeEntries } from './model.ts'

const SHOWN_AFTER_MS = 120

const LENS_PX_PER_S = 300
const LENS_REST_MS = 520
const BUBBLE_REST = 0.42

function stillMotion(): boolean {
  const root = document.documentElement.classList
  return root.contains('reduce-animation') || root.contains('no-entrance-anim')
}

function sweepLens(list: HTMLElement, lens: HTMLElement): Animation[] {
  const height = list.offsetHeight
  const size = lens.offsetHeight
  const travel = height + size
  const pass = (travel / LENS_PX_PER_S) * 1000
  const duration = pass + LENS_REST_MS
  const moving = pass / duration
  const top = list.getBoundingClientRect().top
  const timing: KeyframeAnimationOptions = { duration, iterations: Infinity }
  const at = (y: number) => ((y + size / 2) / travel) * moving

  const runs = [lens.animate([
    { translate: `0 ${-size / 2}px`, opacity: 0 },
    { translate: `0 0px`, opacity: 1, offset: at(0) },
    { translate: `0 ${height}px`, opacity: 1, offset: at(height) },
    { translate: `0 ${height + size / 2}px`, opacity: 0, offset: moving },
    { translate: `0 ${height + size / 2}px`, opacity: 0 },
  ], timing)]

  const swell = (el: Element, rest: Keyframe, peak: Keyframe) => {
    const box = el.getBoundingClientRect()
    const mid = at(box.top - top + box.height / 2)
    const half = ((size / 2) / travel) * moving
    const from = Math.max(0, mid - half)
    const to = Math.min(1, mid + half)
    runs.push(el.animate([
      { ...rest, offset: 0 },
      { ...rest, offset: from, easing: 'ease-in-out' },
      { ...peak, offset: mid, easing: 'ease-in-out' },
      { ...rest, offset: to },
      { ...rest, offset: 1 },
    ], { ...timing, easing: 'linear' }))
  }

  list.querySelectorAll('.build-roster-loading-bubble').forEach((bubble) => {
    swell(bubble, { scale: BUBBLE_REST }, { scale: 1 })
    const tint = bubble.firstElementChild
    if (tint) swell(tint, { opacity: 0 }, { opacity: 1 })
  })
  list.querySelectorAll('.build-roster-group-toggle-mark').forEach((mark) => {
    swell(mark, { scale: 1 }, { scale: 1.22 })
    const icon = mark.querySelector('img')
    if (icon) swell(icon, { opacity: 0.4 }, { opacity: 1 })
  })
  return runs
}

let handoff: { at: number; scrollTop: number; scrollLeft: number } | null = null

/** returns the last observed placeholder offset only after it became visible. */
export function readRosterScrollHandoff(): { scrollTop: number; scrollLeft: number } | null {
  return handoff && performance.now() - handoff.at >= SHOWN_AFTER_MS ? handoff : null
}

export function clearRosterScrollHandoff(): void {
  handoff = null
}

export function LoadingPlaceholder() {
  const scenarioLibrary = useAppStore((state) => state.combat)
  const contextResId = useAppStore(selContextResonatorId)
  const roster = useMemo(() => makeEntries(scenarioLibrary), [scenarioLibrary])
  const groups = useMemo(() => groupByAttribute(roster), [roster])
  const lead = roster.find((entry) => entry.id === contextResId) ?? roster[0] ?? null
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const lensRef = useRef<HTMLSpanElement | null>(null)
  const at = useRef(0)

  useLayoutEffect(() => {
    at.current = performance.now()
    const box = scrollRef.current
    box?.querySelector<HTMLElement>('.build-roster-item[data-active]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
    return () => {
      handoff = {
        at: at.current,
        scrollTop: box?.scrollTop ?? 0,
        scrollLeft: box?.scrollLeft ?? 0,
      }
    }
  }, [])

  useLayoutEffect(() => {
    const list = listRef.current
    const lens = lensRef.current
    if (!list || !lens || stillMotion()) return
    const runs = sweepLens(list, lens)
    return () => runs.forEach((run) => run.cancel())
  }, [groups])

  let bi = 0
  return (
    <div className="build-roster build-roster--held" aria-busy="true">
      <div className="build-roster-scroll" ref={scrollRef}>
        <div className="build-roster-list" ref={listRef}>
          <span className="build-roster-loading-lens" ref={lensRef} aria-hidden="true" />
          {groups.map((group) => {
            const attrIcon = getAttributeIconSrc(group.attribute)
            return (
              <Fragment key={group.attribute}>
                {groups.length > 1 ? (
                  <span className="build-roster-group-toggle" style={{ '--group-ink': group.accent } as CssVars}>
                    <span className="build-roster-group-toggle-mark" aria-hidden="true">
                      {attrIcon ? <DisplayImage src={attrIcon} alt="" decoding="async" onError={withDefIconM} /> : null}
                    </span>
                    <span className="build-roster-group-toggle-n" aria-hidden="true">{group.items.length}</span>
                  </span>
                ) : null}
                <div className="build-roster-group">
                  <div className="build-roster-group-body">
                    {group.items.map((entry) => {
                      const isLead = entry.id === lead?.id
                      return (
                        <span key={entry.id}
                          className="build-roster-item"
                          style={{ '--row-ink': entry.accent, '--bi': bi++ } as CssVars}
                          data-active={isLead ? 'true' : undefined}
                        >
                          <span className="build-roster-item-image">
                            {isLead
                              ? <DisplayImage src={entry.profile} alt="" decoding="async" onError={withDefIconM} />
                              : <span className="build-roster-loading-bubble"><i /></span>}
                          </span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              </Fragment>
            )
          })}
        </div>
      </div>

      <div className="build-roster-footer" aria-hidden="true">
        <span className="build-roster-add"><UsersRound size="1em" /></span>
        <div className="build-roster-status">
          {lead ? (
            <>
              <strong className="build-roster-status-name">{lead.name}</strong>
              <span className="build-roster-status-sub" style={{ '--row-ink': lead.accent } as CssVars}>
                <span className="build-roster-status-lv">Lv {lead.level}</span>
                <span className="build-roster-status-seq">
                  {Array.from({ length: 6 }, (_, pip) => (
                    <i key={pip} data-on={pip < lead.sequence ? 'true' : undefined} />
                  ))}
                </span>
              </span>
            </>
          ) : null}
        </div>
      </div>
      <span className="build-roster-loading-say">Loading roster</span>
    </div>
  )
}
