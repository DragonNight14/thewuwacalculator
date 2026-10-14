/*
  Author: Runor Ewhro
  description: coordinates versioned acknowledgement, visible-time gating,
               focus containment, and reopening for the build score warning.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isScoreWarningSeen, markScoreWarningSeen } from '@/application/persistence/scoreWarning.ts'

const HOLD_MS = 10000
const CLOSE_MS = 800
const CARD_LINGER_MS = 180
const PHOEBE = '/assets/app/phoebe-angy.gif'
const DOCS_HREF = '/docs?topic=build-evaluation'

const HEAD = "DO NOT BE AN IDIOT!"
const POINTS: Array<[string, string]> = [
  ['One fixed rotation.', 'Build Score measures how much damage this build deals over one rotation, with this WEAPON, TEAM, ENABLED EFFECTS and ENEMY TARGET.'],
  ["Setups don't share a scale.", "Change the WEAPON, TEAM, ENABLED EFFECTS or ENEMY TARGET and the 0%, 100% and 200% references are rebuilt, so scores from different setups CANNOT be compared."],
  ['Use it to compare Echoes.', 'Within one setup, the score shows how close your ECHO BUILD come to generated reference builds.'],
  ['Energy Regen changes references.', 'References are built to YOUR Energy Regen target and utility sonata sets, so a build can deal more damage and STILL score lower.'],
]
const TICKER_REPEAT = 10

type Showing = 'first' | 'again' | null

export function ScoreWarning({ active }: { active: boolean }) {
  const [seen, setSeen] = useState(isScoreWarningSeen)
  const [reopened, setReopened] = useState(false)
  const [closing, setClosing] = useState(false)

  const showing: Showing = reopened ? 'again' : active && !seen ? 'first' : null

  const dismiss = useCallback(() => {
    markScoreWarningSeen()
    setClosing(true)
    window.setTimeout(() => {
      setSeen(true)
      setReopened(false)
      setClosing(false)
    }, CLOSE_MS)
  }, [])

  return createPortal(
    <>
      {showing ? (
        <WarningBand key={showing} held={showing === 'first'} closing={closing} onDismiss={dismiss} />
      ) : null}
      {seen && !reopened ? <EdgeTab onOpen={() => setReopened(true)} /> : null}
    </>,
    document.body,
  )
}

function WarningBand({ held, closing, onDismiss }: { held: boolean; closing: boolean; onDismiss: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const capRef = useRef<HTMLButtonElement>(null)
  const [secondsLeft, setSecondsLeft] = useState(held ? HOLD_MS / 1000 : 0)
  const ready = secondsLeft === 0

  // clamping each frame delta prevents hidden-tab suspension from satisfying the hold.
  useEffect(() => {
    if (!held) return
    let spent = 0
    let last = performance.now()
    let frame = 0
    const step = (now: number) => {
      spent += Math.min(now - last, 100)
      last = now
      const progress = Math.min(1, spent / HOLD_MS)
      capRef.current?.style.setProperty('--scw-p', String(progress))
      setSecondsLeft(Math.ceil((HOLD_MS - spent) / 1000))
      if (progress < 1) frame = requestAnimationFrame(step)
      else setSecondsLeft(0)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [held])

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (ready) capRef.current?.focus({ preventScroll: true })
  }, [ready])

  // only explicit acknowledgement may dismiss the warning; focus remains contained.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (event.key !== 'Tab' || !rootRef.current) return
      const stops = Array.from(rootRef.current.querySelectorAll<HTMLElement>('button, a[href]'))
      if (stops.length === 0) return
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === rootRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const ticker = (
    <div>
      {Array.from({ length: TICKER_REPEAT * 2 }, (_, index) => (
        <span key={index}><i className="scw-tri" />Read before you decide to be an idiot</span>
      ))}
    </div>
  )

  return (
    <div
      ref={rootRef}
      className={`scw${closing ? ' is-closing' : ''}`}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="scw-head"
      aria-describedby="scw-points"
      tabIndex={-1}
    >
      <div className="scw-band">
        <div className="scw-tick" aria-hidden="true">{ticker}</div>
        <div className="scw-in">
          <div className="scw-copy">
            <div className="scw-flagline">
              <span className="scw-flag"><i className="scw-tri" />Warning</span>
              <span>Read this before you compare scores</span>
            </div>
            <h2 className="scw-head" id="scw-head">{HEAD}</h2>
            <ul className="scw-points" id="scw-points">
              {POINTS.map(([lead, body]) => (
                <li key={lead}><i className="scw-spark" /><span><b>{lead}</b> {body}</span></li>
              ))}
            </ul>
            <div className="scw-acts">
              <button
                ref={capRef}
                type="button"
                className={`scw-cap${ready ? ' is-ready' : ''}`}
                aria-disabled={!ready}
                onClick={() => { if (ready && !closing) onDismiss() }}
              >
                <span className="scw-cap-ink" />
                <span>{ready ? 'Understood, hide warning' : `Understood (${secondsLeft})`}</span>
              </button>
              {/* documentation navigation must not persist acknowledgement. */}
              <a className="scw-lnk" href={DOCS_HREF} target="_blank" rel="noopener">How the score works</a>
            </div>
          </div>
          <div className="scw-mate" aria-hidden="true">
            <span className="scw-aside">do NOT skip this!!</span>
            <img src={PHOEBE} alt="" />
          </div>
        </div>
        <div className="scw-tick scw-tick--rev" aria-hidden="true">{ticker}</div>
      </div>
    </div>
  )
}

function EdgeTab({ onOpen }: { onOpen: () => void }) {
  const tabRef = useRef<HTMLButtonElement>(null)
  const lingerRef = useRef(0)
  const [open, setOpen] = useState(false)
  const [top, setTop] = useState(0)

  const show = () => {
    window.clearTimeout(lingerRef.current)
    const rect = tabRef.current?.getBoundingClientRect()
    if (rect) setTop(rect.top + rect.height / 2)
    setOpen(true)
  }
  const hide = () => {
    lingerRef.current = window.setTimeout(() => setOpen(false), CARD_LINGER_MS)
  }

  useEffect(() => () => window.clearTimeout(lingerRef.current), [])

  return (
    <>
      <button
        ref={tabRef}
        type="button"
        className={`scw-tab${open ? ' is-open' : ''}`}
        aria-label="Build Score warning: only compare scores within one setup. Open the warning"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={onOpen}
      >
        <i className="scw-tri" />
        <span>Scores: same setup only</span>
      </button>
      <div
        className={`scw-card${open ? ' is-on' : ''}`}
        style={{ top }}
        role="tooltip"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <img src={PHOEBE} alt="" />
        <span>
          <b>Only compare Build Scores within one setup.</b> A different weapon, team, sequence,
          rotation or enemy puts the score on a different scale.
        </span>
        <button type="button" tabIndex={open ? 0 : -1} onClick={onOpen}>Read the warning again</button>
      </div>
    </>
  )
}
