/*
  Author: Runor Ewhro
  description: stages rover gender changes, summarizes affected persisted
               artifacts, and commits the confirmed identity conversion.
*/

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { useAppStore } from '@/application/state'
import { ROVER_PAIRS, type RoverGender } from '@/domain/entities/roverGender'
import { ATTR_COLORS, getAttributeIconSrc } from '@/domain/gameData/attributeDisplay'
import type { AttributeKey } from '@/domain/entities/stats'
import {
  countRoverSaves,
  describeRoverSaves,
  pluralSaves,
  totalRoverSaves,
  type RoverForm,
} from '@/modules/calibration/model/roverSaves'

const FACE: Record<RoverForm, string> = {
  male: `/assets/game/resonators/profiles/${ROVER_PAIRS[0].male}.webp`,
  female: `/assets/game/resonators/profiles/${ROVER_PAIRS[0].female}.webp`,
}
const NAME: Record<RoverGender, string> = { both: 'Both', male: 'Male', female: 'Female' }
const NOTCHES: RoverGender[] = ['male', 'both', 'female']
const ORB_ANGLES = [-135, -45, 45, 135]

const other = (form: RoverForm): RoverForm => (form === 'male' ? 'female' : 'male')
const titleCase = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

export function RoverMedallion() {
  const applied = useAppStore((state) => state.ui.preferences.roverGender)
  const library = useAppStore((state) => state.library)
  const setRoverGender = useAppStore((state) => state.setRoverGender)
  const counts = useMemo(() => countRoverSaves(library), [library])

  const [staged, setStaged] = useState<RoverGender | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const shown = staged ?? applied

  const coinRef = useRef<HTMLDivElement | null>(null)
  const [face, setFace] = useState<RoverGender>(shown)
  const faceRef = useRef(face)
  useEffect(() => {
    faceRef.current = face
  }, [face])
  useEffect(() => {
    const coin = coinRef.current
    const from = faceRef.current
    if (!coin || from === shown) return undefined
    const still = typeof coin.animate !== 'function'
      || document.documentElement.classList.contains('reduce-animation')
    const turn = shown === 'female' || (shown === 'both' && from === 'male') ? 1 : -1
    let cancelled = false
    const out = still
      ? null
      : coin.animate(
        [{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${turn * 90}deg)` }],
        { duration: 180, easing: 'cubic-bezier(.5, 0, .9, .5)' },
      )
    let back: Animation | null = null
    const land = () => {
      if (cancelled) return
      setFace(shown)
      if (still) return
      back = coin.animate(
        [{ transform: `rotateY(${-turn * 90}deg)` }, { transform: 'rotateY(0deg)' }],
        { duration: 420, easing: 'cubic-bezier(.15, .9, .3, 1.25)' },
      )
    }
    if (out) out.onfinish = land
    else queueMicrotask(land)
    return () => {
      cancelled = true
      out?.cancel()
      back?.cancel()
    }
  }, [shown])

  const stage = (next: RoverGender) => {
    setDone(null)
    setStaged(next === applied ? null : next)
  }

  const pickHalf = (form: RoverForm) => stage(shown === form ? 'both' : form)

  const onNotchKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = NOTCHES[(NOTCHES.indexOf(shown) + step + NOTCHES.length) % NOTCHES.length]
    stage(next)
    const target = event.currentTarget.querySelector<HTMLButtonElement>(`[data-notch="${next}"]`)
    target?.focus()
  }

  const apply = () => {
    if (!staged) return
    const target = staged
    const moved = target === 'both' ? 0 : totalRoverSaves(counts[other(target)])
    setRoverGender(target)
    setStaged(null)
    setDone(
      target === 'both'
        ? 'Both Rovers are back in the picker.'
        : moved
          ? `Switched. ${pluralSaves(moved, 'save')} now use the ${target} Rover.`
          : `Nice, you'll only ever see ${target} Rover.`,
    )
  }

  const forms: RoverForm[] = face === 'both' ? ['male', 'female'] : [face]

  return (
    <div className="cal-rov">
      <div className="cal-rov__stage">
        <div className="cal-rov__coinw">
          <span className="cal-rov__ring" aria-hidden="true" />
          {ROVER_PAIRS.map((pair, index) => {
            const angle = (ORB_ANGLES[index] * Math.PI) / 180
            return (
              <span
                key={pair.attribute}
                className="cal-rov__orb"
                aria-hidden="true"
                style={{
                  left: `calc(50% + ${Math.cos(angle) * 7.5}rem)`,
                  top: `calc(50% + ${Math.sin(angle) * 7.5}rem)`,
                }}
              >
                <img src={getAttributeIconSrc(pair.attribute) ?? undefined} alt="" />
              </span>
            )
          })}

          <div className="cal-rov__coin" ref={coinRef} data-face={face}>
            <div className="cal-rov__face">
              {(['male', 'female'] as const).map((form) => (
                <button
                  key={form}
                  type="button"
                  className={`cal-rov__half cal-rov__half--${form}`}
                  aria-label={`${NAME[form]} Rover`}
                  aria-pressed={shown === form}
                  tabIndex={-1}
                  onClick={() => pickHalf(form)}
                >
                  <img src={FACE[form]} alt="" draggable={false} />
                </button>
              ))}
            </div>
            <span className="cal-rov__seam" aria-hidden="true" />
          </div>

          <div className="cal-rov__notch" role="radiogroup" aria-label="Rover form" onKeyDown={onNotchKey}>
            {NOTCHES.map((gender) => (
              <button
                key={gender}
                type="button"
                role="radio"
                data-notch={gender}
                aria-checked={shown === gender}
                tabIndex={shown === gender ? 0 : -1}
                onClick={() => stage(gender)}
              >
                {NAME[gender]}
              </button>
            ))}
          </div>
        </div>

        <div className="cal-rov__copy">
          <b><span>{NAME[shown]}</span> {shown === 'both' ? 'Rovers' : 'Rover'}</b>
          <p className="cal-help">
            {shown === 'both'
              ? 'Every list offers both forms. Existing saves keep their current Rover.'
              : `Every list offers the ${shown} Rover only, and saves made with the ${other(shown)} Rover take on the ${shown} one.`}
          </p>
          <div className="cal-rov__forms">
            {ROVER_PAIRS.map((pair) => {
              const saves = forms.reduce((sum, form) => sum + (counts[form].byAttribute[pair.attribute] ?? 0), 0)
              return (
                <span key={pair.attribute} style={{ '--rov-el': ATTR_COLORS[pair.attribute as AttributeKey] } as CSSProperties}>
                  <img src={getAttributeIconSrc(pair.attribute) ?? undefined} alt="" />
                  {titleCase(pair.attribute)}
                  <em className="cal-num">{saves ? pluralSaves(saves, 'save') : 'no saves'}</em>
                </span>
              )
            })}
          </div>
        </div>
      </div>

      {staged ? (
        <RoverTrade
          applied={applied}
          staged={staged}
          counts={counts}
          onApply={apply}
          onKeep={() => stage(applied)}
        />
      ) : done ? (
        <p className="cal-note cal-note--ok" role="status">{done}</p>
      ) : null}
    </div>
  )
}

// excluded identities are converted irreversibly, so selection remains staged
// until the affected-save summary is confirmed.
function RoverTrade({
  applied,
  staged,
  counts,
  onApply,
  onKeep,
}: {
  applied: RoverGender
  staged: RoverGender
  counts: ReturnType<typeof countRoverSaves>
  onApply: () => void
  onKeep: () => void
}) {
  let figure: ReactNode
  let lead: string
  let after: string
  let action: string

  if (staged === 'both') {
    const kept = applied === 'both' ? 'male' : applied
    figure = (
      <>
        <img className="is-on" src={FACE.male} alt="" />
        <img className="is-on" src={FACE.female} alt="" />
      </>
    )
    lead = `Nothing in your saves changes. They keep the ${kept} Rover, and the ${other(kept)} Rover starts fresh the first time you add them.`
    after = 'Undo history clears.'
    action = 'Show both Rovers'
  } else {
    const from = other(staged)
    const leaving = counts[from]
    const moved = totalRoverSaves(leaving)
    figure = (
      <>
        <img className="is-off" src={FACE[from]} alt="" />
        <i aria-hidden="true" />
        <img className="is-on" src={FACE[staged]} alt="" />
      </>
    )
    if (moved) {
      const shared = applied === 'both' && leaving.shared
        ? ` ${pluralSaves(leaving.shared, 'save')} ${leaving.shared === 1 ? 'contains' : 'contain'} both forms, so each keeps whichever has the fuller setup.`
        : ''
      lead = `${describeRoverSaves(leaving)} using the ${from} Rover will switch to the ${staged} Rover.${shared}`
      after = 'Open scenarios follow too. If both Rover contexts collide, the larger scenario stays. Undo history clears and a running optimizer search stops.'
      action = `Switch saves to the ${staged} Rover`
    } else {
      lead = `No saved builds, rotations, or scenarios use the ${from} Rover. The picker stops listing that Rover.`
      after = 'Open scenarios still follow this choice. Undo history clears and a running optimizer search stops.'
      action = `Hide the ${from} Rover`
    }
  }

  return (
    <div className="cal-rov__trade" role="region" aria-label="What this changes">
      <div className="cal-rov__fig">{figure}</div>
      <div className="cal-rov__say">
        <p>{lead}</p>
        <p>{after}</p>
      </div>
      <div className="cal-rov__acts">
        <button type="button" className="cal-btn" onClick={onApply}>{action}</button>
        <button type="button" className="cal-btn cal-btn--quiet" onClick={onKeep}>
          {applied === 'both' ? 'Keep both' : `Keep the ${applied} Rover`}
        </button>
      </div>
    </div>
  )
}
