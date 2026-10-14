/*
  Author: Runor Ewhro
  description: renders an animated details panel with rotation size and team portraits.
*/

import { DisplayImage } from '@/shared/ui/DisplayImage'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { type CssVars } from '@/modules/simulation/workspace/ui.tsx'
import type { Entry } from './List.tsx'

export interface Teammate {
  id: string
  name: string
  profile: string
  accent: string
}

export interface Target {
  entry: Entry
  /** the context resonator: its face and its teammates open the console. */
  lead: boolean
  /** item centre, in px against the column. */
  x: number
  y: number
}

// allow the closing width transition to finish before unmounting.
const LEAVE_MS = 420
// overlap the outgoing and incoming details during a member change.
const SWAP_MS = 180

function reduced(): boolean {
  const root = typeof document === 'undefined' ? null : document.documentElement
  return Boolean(root && (root.classList.contains('reduce-animation') || root.classList.contains('no-entrance-anim')))
}

function nodesNote(entry: Entry): string | null {
  if (entry.rotationNodes === 0) return null
  return `${entry.rotationNodes} ${entry.rotationNodes === 1 ? 'node' : 'nodes'}`
}

function RosterDetailsContent({
  target,
  mates,
  enter,
  leaving,
  onMate,
}: {
  target: Target
  mates: Teammate[]
  enter?: 'mount' | 'swap'
  leaving?: boolean
  onMate: (resonatorId: string) => void
}) {
  const note = nodesNote(target.entry)
  const withTeam = target.lead && mates.length > 0
  return (
    <div className="build-roster-details-body"
      data-enter={leaving ? undefined : enter}
      data-leaving={leaving ? 'true' : undefined}
      aria-hidden={leaving || undefined}
    >
      <span className="build-roster-details-text" style={{ '--i': 0 } as CssVars}>
        <b className="build-roster-details-name">{target.entry.name}</b>
        {note ? <span className="build-roster-details-note">{note}</span> : null}
      </span>
      {withTeam ? (
        <>
          <i className="build-roster-details-div" style={{ '--i': 1 } as CssVars} aria-hidden="true" />
          <span className="build-roster-details-mates" style={{ '--i': 2 } as CssVars}>
            {mates.map((mate, index) => (
              <button
                key={mate.id}
                type="button" className="build-roster-teammate"
                style={{ '--mate': mate.accent, '--i': index } as CssVars}
                aria-label={`Edit ${mate.name}`}
                title={`Edit ${mate.name}`}
                tabIndex={leaving ? -1 : 0}
                onClick={() => onMate(mate.id)}
              >
                <DisplayImage src={mate.profile} alt="" decoding="async" onError={withDefIconM} />
              </button>
            ))}
          </span>
        </>
      ) : null}
    </div>
  )
}

export function Details({
  target,
  mates,
  onFace,
  onFaceMenu,
  onMate,
}: {
  target: Target | null
  mates: Teammate[]
  onFace: (entry: Entry) => void
  onFaceMenu: (entry: Entry, event: ReactMouseEvent<HTMLElement>) => void
  onMate: (resonatorId: string) => void
}) {
  const [shown, setShown] = useState<Target | null>(target)
  const [phase, setPhase] = useState<'in' | 'out'>('in')
  const [mount, setMount] = useState(0)
  const [mountKey, setMountKey] = useState(target ? `${target.entry.id}:${target.lead}` : '')
  const [leaving, setLeaving] = useState<Target | null>(null)
  const capRef = useRef<HTMLDivElement | null>(null)
  const bodiesRef = useRef<HTMLDivElement | null>(null)
  const measuredMount = useRef(-1)

  /* update the displayed member during render to avoid showing stale details;
     animate a new entrance when the previous panel is closing or absent. */
  if (target && target !== shown) {
    const key = `${target.entry.id}:${target.lead}`
    if (!shown || phase === 'out') {
      setShown(target)
      setPhase('in')
      setMount((value) => value + 1)
      setMountKey(key)
      setLeaving(null)
    } else {
      if (key !== `${shown.entry.id}:${shown.lead}`) setLeaving(shown)
      setShown(target)
    }
  } else if (!target && shown && phase === 'in') {
    setPhase('out')
  }

  useEffect(() => {
    if (phase !== 'out') return undefined
    const timer = window.setTimeout(() => setShown(null), reduced() ? 0 : LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (!leaving) return undefined
    const timer = window.setTimeout(() => setLeaving(null), SWAP_MS)
    return () => window.clearTimeout(timer)
  }, [leaving])

  // set the panel width directly during the transition to preserve its current
  // position across renders; new panels start at the roster item's width.
  useLayoutEffect(() => {
    const cap = capRef.current
    const bodies = bodiesRef.current
    if (!cap || !bodies || !shown) return
    if (phase === 'out') {
      cap.style.setProperty('--bw', '0px')
      return
    }
    if (measuredMount.current !== mount) {
      measuredMount.current = mount
      cap.style.setProperty('--bw', '0px')
      void cap.offsetWidth
    }
    cap.style.setProperty('--bw', `${bodies.offsetWidth}px`)
  })

  if (!shown) return null

  const { entry, lead } = shown
  const bodyKey = `${entry.id}:${lead}`

  return (
    <div
      key={mount}
      ref={capRef} className="build-roster-details"
      data-phase={phase}
      data-lead={lead ? 'true' : undefined}
      style={{
        '--row-ink': entry.accent,
        '--cx': `${shown.x}px`,
        '--cy': `${shown.y}px`,
      } as CssVars}
    >
      <button
        type="button" className="build-roster-details-face"
        aria-label={lead ? `Edit ${entry.name}` : `Switch to ${entry.name}`}
        title={lead ? `Edit ${entry.name}` : undefined}
        tabIndex={phase === 'out' ? -1 : 0}
        onClick={() => onFace(entry)}
        onContextMenu={(event) => onFaceMenu(entry, event)}
      >
        <DisplayImage key={entry.id} src={entry.profile} alt="" decoding="async" onError={withDefIconM} />
      </button>
      <div className="build-roster-details-bodies" ref={bodiesRef}>
        {leaving ? (
          <RosterDetailsContent
            key={`out:${leaving.entry.id}:${leaving.lead}`}
            target={leaving}
            mates={mates}
            leaving
            onMate={onMate}
          />
        ) : null}
        <RosterDetailsContent
          key={bodyKey}
          target={shown}
          mates={mates}
          enter={bodyKey === mountKey ? 'mount' : 'swap'}
          onMate={onMate}
        />
      </div>
    </div>
  )
}
