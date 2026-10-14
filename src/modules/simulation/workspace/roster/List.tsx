/*
  Author: Runor Ewhro
  description: projects canonical profiles into ordered attribute groups and surface-specific roster metadata.
*/

import { DisplayImage } from '@/shared/ui/DisplayImage'
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { KeyboardEvent, MouseEvent, RefCallback } from 'react'
import { UsersRound } from 'lucide-react'
import type { AttributeKey } from '@/domain/entities/stats'
import type { CombatScenarioId } from '@/domain/entities/combatScenario'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { toTitle } from '@/shared/lib/format'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import { type CssVars } from '@/modules/simulation/workspace/ui.tsx'
import { Details, type Teammate, type Target } from './Details.tsx'
import { clearRosterScrollHandoff, readRosterScrollHandoff } from './LoadingPlaceholder.tsx'
import { useDragRemove, type DragState } from './useDragRemove.ts'

/* rotation view shows rotation metadata alongside the shared roster. */
export type View = 'build' | 'rotation'

const FIND_RESET_MS = 1100

export interface AttributeGroup {
  attribute: AttributeKey
  accent: string
  items: Entry[]
}

export interface Entry {
  id: string
  scenarioId: CombatScenarioId
  name: string
  profile: string
  attribute: AttributeKey
  accent: string
  level: number
  sequence: number
  /** size of the authored rotation, and zero when none has been written. */
  rotationNodes: number
}

export interface Selection {
  selectionMode: boolean
  isSelected: (id: string) => boolean
  buildClickCapture: (id: string) => (event: MouseEvent<HTMLElement>) => void
  getItems: (id: string) => MenuEntry[]
  surfaceProps: {
    ref?: RefCallback<HTMLElement>
    tabIndex?: number
    onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
    'data-selection-focus-scope'?: string
    'data-selection-focus-active'?: string
    'data-selection-mode-active'?: string
  }
}

function seqPips(sequence: number) {
  return Array.from({ length: 6 }, (_, pip) => (
    <i key={pip} data-on={pip < sequence ? 'true' : undefined} />
  ))
}

// the only resonator detail that its portrait cannot show.
function rotationNote(entry: Entry): string {
  if (entry.rotationNodes === 0) return 'No rotation'
  return `${entry.rotationNodes} ${entry.rotationNodes === 1 ? 'node' : 'nodes'}`
}

function reduceMotion(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.classList.contains('reduce-animation')
}

export function List({
  roster,
  groups,
  contextResId,
  view,
  onContextChange,
  onAddResonator,
  backgroundItems,
  selection,
  mates = [],
  onOpenMember,
  onRemove,
  confirmRemoval = false,
}: {
  roster: Entry[]
  groups: AttributeGroup[]
  contextResId: string | null
  /** roster data selected by the adjacent surface */
  view: View
  onContextChange: (id: string) => void
  onAddResonator?: () => void
  backgroundItems?: MenuEntry[]
  selection?: Selection
  /** teammates shown in the selected resonator's details panel. */
  mates?: Teammate[]
  /** opens a teammate's member console. */
  onOpenMember?: (resonatorId: string) => void
  /** removes an item after its drag gesture completes. */
  onRemove?: (resonatorId: string) => void
  /** pending removal returns the pulled item to its home position. */
  confirmRemoval?: boolean
}) {
  const columnRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLElement | null>(null)
  const dragLineRef = useRef<SVGSVGElement | null>(null)
  const previewRef = useRef<HTMLElement | null>(null)
  const findTimer = useRef(0)
  const [folded, setFolded] = useState<ReadonlySet<AttributeKey>>(() => new Set())
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [geom, setGeom] = useState<{ id: string; x: number; y: number } | null>(null)
  const [find, setFind] = useState('')
  const [pulled, setPulled] = useState<DragState | null>(null)
  const releaseTimer = useRef(0)
  // restore the captured scroll position before paint, then consume the handoff once.
  const [scrollHandoff] = useState(readRosterScrollHandoff)

  useLayoutEffect(() => {
    const box = scrollRef.current
    if (scrollHandoff && box) {
      box.scrollTop = scrollHandoff.scrollTop
      box.scrollLeft = scrollHandoff.scrollLeft
    }
    clearRosterScrollHandoff()
  }, [scrollHandoff])

  const contextEntry = useMemo(
    () => roster.find((entry) => entry.id === contextResId) ?? roster[0] ?? null,
    [contextResId, roster],
  )

  // show the dragged item's name while it is being removed.
  const capEntry = useMemo(
    () => (pulled ? roster.find((entry) => entry.id === pulled.id) : null) ?? contextEntry,
    [contextEntry, pulled, roster],
  )

  const noRemove = useCallback(() => undefined, [])
  const pull = useDragRemove({
    enabled: Boolean(onRemove) && !selection?.selectionMode,
    confirmRemoval: confirmRemoval,
    columnRef,
    scrollRef,
    listRef,
    dragLineRef,
    previewRef,
    onState: setPulled,
    onRemove: onRemove ?? noRemove,
  })

  const setListRef = useCallback((element: HTMLElement | null) => {
    listRef.current = element
    selection?.surfaceProps.ref?.(element)
  }, [selection])

  const itemOf = useCallback((id: string) => (
    listRef.current?.querySelector<HTMLElement>(`[data-roster-item][data-res-id="${CSS.escape(id)}"]`) ?? null
  ), [])

  const [lastContextId, setLastContextId] = useState(contextResId)
  if (contextResId !== lastContextId) {
    setLastContextId(contextResId)
    if (contextEntry && folded.has(contextEntry.attribute)) {
      const opened = new Set(folded)
      opened.delete(contextEntry.attribute)
      setFolded(opened)
    }
  }

  useEffect(() => {
    if (!contextEntry) return
    const item = itemOf(contextEntry.id)
    const box = scrollRef.current
    if (!item || !box) return
    const boxRect = box.getBoundingClientRect()
    const rect = item.getBoundingClientRect()
    if (rect.top >= boxRect.top && rect.bottom <= boxRect.bottom
      && rect.left >= boxRect.left && rect.right <= boxRect.right) {
      return
    }
    item.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: reduceMotion() ? 'auto' : 'smooth',
    })
  }, [itemOf, contextEntry, folded])

  const releasePreview = useCallback((id?: string) => {
    window.clearTimeout(releaseTimer.current)
    releaseTimer.current = window.setTimeout(() => {
      setPreviewId((current) => (id == null || current === id ? null : current))
    }, 160)
  }, [])

  const hasRotationDetails = useCallback((entry: Entry) => (
    view === 'rotation' && (entry.id === contextEntry?.id || entry.rotationNodes > 0)
  ), [contextEntry, view])

  const detailsEntry = useMemo(() => {
    if (!pinnedId) return null
    const entry = roster.find((item) => item.id === pinnedId) ?? null
    return entry && hasRotationDetails(entry) ? entry : null
  }, [hasRotationDetails, pinnedId, roster])

  const measureFor = useCallback((id: string): boolean => {
    const item = itemOf(id)
    const column = columnRef.current
    const box = scrollRef.current
    if (!item || !column || !box) return false
    const b = item.getBoundingClientRect()
    const c = column.getBoundingClientRect()
    const view = box.getBoundingClientRect()
    const mid = b.top + b.height / 2
    if (mid < view.top + 8 || mid > view.bottom - 8) {
      setGeom(null)
      return false
    }
    const next = { id, x: b.left + b.width / 2 - c.left, y: mid - c.top }
    setGeom((prev) => (
      prev && prev.id === next.id && prev.x === next.x && prev.y === next.y ? prev : next
    ))
    return true
  }, [itemOf])

  const measure = useCallback(() => {
    if (detailsEntry && !measureFor(detailsEntry.id)) setPinnedId(null)
  }, [detailsEntry, measureFor])

  const togglePin = useCallback((id: string) => {
    if (pinnedId === id) {
      setPinnedId(null)
      return
    }
    if (measureFor(id)) setPinnedId(id)
  }, [measureFor, pinnedId])

  useEffect(() => {
    if (!pinnedId) return undefined
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.build-roster-details, .build-roster-rotation-toggle, [data-roster-item][data-active]')) return
      setPinnedId(null)
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setPinnedId(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinnedId])

  const pointAt = useCallback((id: string) => {
    window.clearTimeout(releaseTimer.current)
    setPreviewId(id)
  }, [])

  useEffect(() => {
    const box = scrollRef.current
    if (!box || !detailsEntry) return undefined
    box.addEventListener('scroll', measure, { passive: true })
    return () => box.removeEventListener('scroll', measure)
  }, [detailsEntry, measure])

  const detailsTarget = useMemo<Target | null>(() => (
    detailsEntry && geom && geom.id === detailsEntry.id
      ? { entry: detailsEntry, lead: detailsEntry.id === contextEntry?.id, x: geom.x, y: geom.y }
      : null
  ), [detailsEntry, contextEntry, geom])

  const onDetailsFace = useCallback((entry: Entry) => {
    if (entry.id !== contextEntry?.id || selection?.selectionMode || !onOpenMember) {
      setPinnedId(null)
      itemOf(entry.id)?.click()
      return
    }
    onOpenMember(entry.id)
  }, [itemOf, contextEntry, onOpenMember, selection])

  const onDetailsMenu = useCallback((entry: Entry, event: MouseEvent<HTMLElement>) => {
    const item = itemOf(entry.id)
    if (!item) return
    event.preventDefault()
    item.dispatchEvent(new window.MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
    }))
  }, [itemOf])

  const onRosterTeammate = useCallback((resonatorId: string) => {
    onOpenMember?.(resonatorId)
  }, [onOpenMember])

  useEffect(() => () => {
    window.clearTimeout(findTimer.current)
    window.clearTimeout(releaseTimer.current)
  }, [])

  const visibleEntries = useMemo(
    () => groups.flatMap((group) => (folded.has(group.attribute) ? [] : group.items)),
    [folded, groups],
  )

  const toggleGroup = useCallback((attribute: AttributeKey) => {
    setFolded((current) => {
      const next = new Set(current)
      if (next.has(attribute)) next.delete(attribute)
      else next.add(attribute)
      return next
    })
  }, [])

  const focusItem = useCallback((entry: Entry | undefined) => {
    if (!entry) return
    const item = itemOf(entry.id)
    if (!item) return
    item.focus()
    item.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' })
  }, [itemOf])

  const stepFocus = useCallback((delta: number) => {
    if (visibleEntries.length === 0) return
    const focused = document.activeElement as HTMLElement | null
    const here = focused?.dataset.resId
      ? visibleEntries.findIndex((entry) => entry.id === focused.dataset.resId)
      : -1
    const from = here >= 0
      ? here
      : visibleEntries.findIndex((entry) => entry.id === contextEntry?.id)
    const next = Math.min(
      visibleEntries.length - 1,
      Math.max(0, (from < 0 ? 0 : from) + (here >= 0 || from >= 0 ? delta : 0)),
    )
    focusItem(visibleEntries[next])
  }, [contextEntry, focusItem, visibleEntries])

  // typing a name scrolls the column to it. committing stays an explicit enter so
  // a search never rebuilds the board under you.
  const typeToFind = useCallback((char: string) => {
    window.clearTimeout(findTimer.current)
    findTimer.current = window.setTimeout(() => setFind(''), FIND_RESET_MS)
    setFind((current) => {
      const query = (current + char).slice(0, 14)
      const lower = query.toLowerCase()
      const hit = visibleEntries.find((entry) => entry.name.toLowerCase().startsWith(lower))
        ?? visibleEntries.find((entry) => entry.name.toLowerCase().includes(lower))
      if (hit) focusItem(hit)
      return query
    })
  }, [focusItem, visibleEntries])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const { key } = event
    if (key === 'ArrowDown' || key === 'ArrowRight') {
      event.preventDefault()
      stepFocus(1)
      return
    }
    if (key === 'ArrowUp' || key === 'ArrowLeft') {
      event.preventDefault()
      stepFocus(-1)
      return
    }
    if (key === 'Home' || key === 'End') {
      event.preventDefault()
      focusItem(key === 'Home' ? visibleEntries[0] : visibleEntries[visibleEntries.length - 1])
      return
    }
    if (key === ' ' && view === 'rotation') {
      const id = (document.activeElement as HTMLElement | null)?.dataset.resId
      const entry = id ? visibleEntries.find((item) => item.id === id) : undefined
      if (entry && hasRotationDetails(entry)) {
        event.preventDefault()
        togglePin(entry.id)
        return
      }
    }
    if (key.length === 1 && key !== ' ' && /\S/.test(key)
      && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      typeToFind(key)
      return
    }
    selection?.surfaceProps.onKeyDown?.(event)
  }, [focusItem, hasRotationDetails, view, selection, stepFocus, togglePin, typeToFind, visibleEntries])

  const onFocusColumn = useCallback((event: { target: EventTarget | null; currentTarget: HTMLElement }) => {
    if (event.target !== event.currentTarget) return
    focusItem(contextEntry ?? undefined)
  }, [contextEntry, focusItem])

  return (
    <ContextTrigger
      asChild
      ariaLabel="Context roster actions"
      getItems={(event) => {
        const target = event.target
        return target instanceof Element && target.closest('button, a, input, .build-roster-details')
          ? []
          : backgroundItems ?? []
      }}
    >
    <div className="build-roster" data-view={view} data-from={scrollHandoff ? 'loading' : undefined} ref={columnRef}>
      <div className="build-roster-scroll" ref={scrollRef}>
        <nav className="build-roster-list"
          aria-label="Context resonators"
          ref={setListRef}
          tabIndex={selection?.surfaceProps.tabIndex ?? 0}
          data-selection-focus-scope={selection?.surfaceProps['data-selection-focus-scope']}
          data-selection-focus-active={selection?.surfaceProps['data-selection-focus-active']}
          data-selection-mode-active={selection?.surfaceProps['data-selection-mode-active']}
          onKeyDown={onKeyDown}
          onFocus={onFocusColumn}
        >
          {groups.map((group, groupIndex) => {
            const isFolded = folded.has(group.attribute)
            const label = toTitle(group.attribute)
            const attrIcon = getAttributeIconSrc(group.attribute)
            return (
              <Fragment key={group.attribute}>
                {groups.length > 1 ? (
                  <button
                    type="button" className="build-roster-group-toggle"
                    style={{ '--group-ink': group.accent } as CssVars}
                    data-folded={isFolded ? 'true' : undefined}
                    aria-expanded={!isFolded}
                    aria-label={`${label}, ${group.items.length} ${group.items.length === 1 ? 'resonator' : 'resonators'}`}
                    title={`${label} (${group.items.length})`}
                    tabIndex={-1}
                    onClick={() => toggleGroup(group.attribute)}
                  >
                    <span className="build-roster-group-toggle-mark" aria-hidden="true">
                      {attrIcon ? (
                        <DisplayImage src={attrIcon} alt="" loading="lazy" decoding="async" onError={withDefIconM} />
                      ) : null}
                    </span>
                    <span className="build-roster-group-toggle-n" aria-hidden="true">{group.items.length}</span>
                  </button>
                ) : null}
                <div className="build-roster-group"
                  data-folded={isFolded ? 'true' : undefined}
                  inert={isFolded}
                >
                  <div className="build-roster-group-body">
                    {group.items.map((entry, index) => {
                      const isContext = entry.id === contextEntry?.id
                      const isPicked = selection?.isSelected(entry.id) ?? false
                      const item = (
                        <button
                          type="button"
                          data-roster-item
                          data-res-id={entry.id}
                          className={[
                            'build-roster-item',
                            isPicked ? 'focus-selected' : '',
                            selection?.selectionMode ? 'selection-mode' : '',
                          ].filter(Boolean).join(' ')}
                          style={{
                            '--row-ink': entry.accent,
                            '--bi': groupIndex * 2 + index,
                          } as CssVars}
                          tabIndex={isContext ? 0 : -1}
                          aria-pressed={isContext}
                          aria-label={[
                            entry.name,
                            `level ${entry.level}`,
                            `sequence ${entry.sequence}`,
                            view === 'rotation' ? rotationNote(entry) : '',
                          ].filter(Boolean).join(', ')}
                          data-active={isContext ? 'true' : undefined}
                          data-pointed={previewId === entry.id ? 'true' : undefined}
                          data-selected={isPicked ? 'true' : undefined}
                          data-selection-focus-item="true"
                          onPointerDown={(event) => pull.onPointerDown(entry.id, event)}
                          onClick={() => {
                            if (pull.swallowClick()) return
                            if (isContext && hasRotationDetails(entry) && !selection?.selectionMode) {
                              togglePin(entry.id)
                              return
                            }
                            onContextChange(entry.id)
                          }}
                          onClickCapture={selection?.buildClickCapture(entry.id)}
                          onPointerEnter={() => pointAt(entry.id)}
                          onPointerLeave={() => releasePreview(entry.id)}
                          onFocus={() => pointAt(entry.id)}
                          onBlur={() => releasePreview(entry.id)}
                        >
                          <span className="build-roster-item-image">
                            <DisplayImage src={entry.profile}
                              alt=""
                              draggable={false}
                              loading="lazy"
                              decoding="async"
                              onError={withDefIconM}
                            />
                          </span>
                        </button>
                      )
                      const pinned = pinnedId === entry.id
                      return (
                        <Fragment key={entry.id}>
                          {selection ? (
                            <ContextTrigger
                              asChild
                              ariaLabel={`${entry.name} actions`}
                              items={selection.getItems(entry.id)}
                            >
                              {item}
                            </ContextTrigger>
                          ) : item}
                          {hasRotationDetails(entry) ? (
                            <span className="build-roster-rotation-toggle-row">
                              <button
                                type="button" className="build-roster-rotation-toggle"
                                style={{ '--row-ink': entry.accent } as CssVars}
                                data-lead={isContext ? 'true' : undefined}
                                data-on={pinned ? 'true' : undefined}
                                tabIndex={-1}
                                aria-expanded={pinned}
                                aria-label={`${entry.name}: ${isContext ? 'team and rotation' : 'rotation'}`}
                                title={isContext ? `${entry.name}: team and rotation` : `${entry.name}: rotation`}
                                onClick={() => togglePin(entry.id)}
                              >
                                <i className="build-roster-rotation-toggle-mark" aria-hidden="true" />
                              </button>
                            </span>
                          ) : null}
                        </Fragment>
                      )
                    })}
                  </div>
                </div>
              </Fragment>
            )
          })}
        </nav>
      </div>

      <svg className="build-roster-drag-line" ref={dragLineRef} aria-hidden="true">
        <path />
      </svg>
      <figure className="build-roster-drag-preview" ref={previewRef} aria-hidden="true">
        <img alt="" draggable={false} />
      </figure>

      {view === 'rotation' ? (
        <Details
          target={detailsTarget}
          mates={mates}
          onFace={onDetailsFace}
          onFaceMenu={onDetailsMenu}
          onMate={onRosterTeammate}
        />
      ) : null}

      <div className="build-roster-footer">
        {onAddResonator ? (
          <button
            type="button" className="build-roster-add"
            onClick={onAddResonator}
            title="See all resonators"
            aria-label="See all resonators"
          >
            <UsersRound size="1em" aria-hidden="true" />
          </button>
        ) : null}

        <div className="build-roster-status" aria-live="polite">
          {find ? (
            <span className="build-roster-status-find">{find}</span>
          ) : capEntry ? (
            <Fragment key={capEntry.id}>
              <strong className="build-roster-status-name" style={{ '--row-ink': capEntry.accent } as CssVars}>
                {capEntry.name}
              </strong>
              {pulled?.free ? (
                <span className="build-roster-status-warn">Let go to remove</span>
              ) : (
                <span className="build-roster-status-sub" style={{ '--row-ink': capEntry.accent } as CssVars}>
                  <span className="build-roster-status-lv">Lv {capEntry.level}</span>
                  <span className="build-roster-status-seq" aria-label={`Sequence ${capEntry.sequence} of 6`}>
                    {seqPips(capEntry.sequence)}
                  </span>
                </span>
              )}
            </Fragment>
          ) : (
            <span className="build-roster-status-empty">No resonators yet</span>
          )}
        </div>
      </div>
    </div>
    </ContextTrigger>
  )
}
