/*
  Author: Runor Ewhro
  description: maps parsed import capabilities to independent load, save, and
               confirmation actions.
*/

import { Bookmark, Check, Circle, X } from 'lucide-react'
import { AppModal, type AppModalState } from '@/shared/ui/AppModal'
import type { ImportLoad, ImportPick, ImportTake } from '@/application/imports/types.ts'
import { useAppStore } from '@/application/state'

interface ImportReceivedProps {
  state: AppModalState
  take: ImportTake
  busy: boolean
  onTake: (pick: ImportPick) => void
  onCancel: () => void
}

function StepBars({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 14" fill="currentColor" aria-hidden="true">
      <rect x="0" y="9" width="3" height="5" rx="1" />
      <rect x="5" y="4" width="3" height="10" rx="1" />
      <rect x="10" y="7" width="3" height="7" rx="1" />
      <rect x="15" y="1" width="3" height="13" rx="1" />
      <rect x="20" y="5" width="3" height="9" rx="1" />
      <rect x="25" y="2" width="3" height="12" rx="1" />
    </svg>
  )
}

function Spark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0c.6 6.4 5.6 11.4 12 12-6.4.6-11.4 5.6-12 12-.6-6.4-5.6-11.4-12-12C6.4 11.4 11.4 6.4 12 0z" />
    </svg>
  )
}

function TakeRead({ pick, take }: { pick: ImportPick; take: ImportTake }) {
  const added = take.count
  return (
    <>
      {take.count > 1 && pick.load !== 'none' ? (
        <>Loads the first, <em>{take.name}</em>. </>
      ) : null}
      {pick.load === 'rotation' ? (
        <>Replaces the steps on <em>{take.resonatorName}</em>. Builds, team and enemy stay as they are.</>
      ) : null}
      {pick.load === 'build' ? (
        <>Replaces <em>{take.resonatorName}</em>'s team, all builds, buffs and the enemy, along with the steps.</>
      ) : null}
      {pick.load === 'none' ? <>Nothing on the page changes.</> : null}
      {pick.save ? (
        <> Adds <em>{added}</em> to saved rotations ({take.savedCount} → {take.savedCount + added}).</>
      ) : null}
    </>
  )
}

export function ImportReceived({ state, take, busy, onTake, onCancel }: ImportReceivedProps) {
  const { load, save } = useAppStore((app) => app.ui.preferences.rotationImportPick)
  const setPick = useAppStore((app) => app.setRotationImportPick)
  const pick: ImportPick = { load, save }
  const idle = load === 'none' && !save
  const tick = (next: Exclude<ImportLoad, 'none'>) => setPick({ load: load === next ? 'none' : next, save })
  const single = take.count === 1

  return (
    <AppModal state={state} variant="import-received" ariaLabel={`Import ${take.name}`} onClose={() => {
      if (!busy) onCancel()
    }}>
      <Spark className="irc-star irc-star--top" />
      <Spark className="irc-star irc-star--bottom" />
      <h2 className="irc-title">
        <Spark />
        {single ? take.name : `${take.count} rotations shared`}
        <Spark />
      </h2>
      <p className="irc-sub">
        {single
          ? `Shared rotation for ${take.resonatorName}. Pick what to take.`
          : `Loading takes the first, ${take.name}.`}
      </p>

      <div className="irc-tiles">
        <button
          type="button" className="irc-tile"
          role="radio"
          aria-checked={load === 'rotation'}
          disabled={busy}
          data-included={load === 'build' || undefined}
          onClick={() => tick('rotation')}
        >
          <span className="irc-tile__tick"><Check /></span>
          <span className="irc-tile__art">
            <span className="irc-tile__count">{take.steps} steps</span>
            <StepBars className="irc-tile__glyph" />
          </span>
          <span className="irc-tile__name">Rotation</span>
          <span className="irc-tile__sub">{load === 'build' ? 'Comes with the build' : 'Steps only'}</span>
        </button>

        <button
          type="button" className="irc-tile"
          role="radio"
          aria-checked={load === 'build'}
          disabled={busy}
          onClick={() => tick('build')}
        >
          <span className="irc-tile__tick"><Check /></span>
          <span className="irc-tile__art">
            <img className="irc-tile__portrait" src={take.profile} alt="" />
            {take.weaponIcon ? <img className="irc-tile__weapon" src={take.weaponIcon} alt="" /> : null}
            <span className="irc-tile__count">Lv {take.level}</span>
          </span>
          <span className="irc-tile__name">Full build</span>
          <span className="irc-tile__sub">Team, builds, enemy</span>
        </button>

        <span className="irc-tiles__rule" aria-hidden="true" />

        <button
          type="button" className="irc-tile"
          role="checkbox"
          aria-checked={save}
          disabled={busy}
          onClick={() => setPick({ load, save: !save })}
        >
          <span className="irc-tile__tick"><Check /></span>
          <span className="irc-tile__art">
            <span className="irc-tile__count">{take.savedCount} saved</span>
            <Bookmark className="irc-tile__mark" strokeWidth={1.6} />
          </span>
          <span className="irc-tile__name">Saved list</span>
          <span className="irc-tile__sub">Keep a copy</span>
        </button>
      </div>

      <p className="irc-read" aria-live="polite">
        <TakeRead pick={pick} take={take} />
      </p>

      <div className="irc-actions">
        <button type="button" className="irc-btn" disabled={busy} onClick={onCancel}>
          <span className="irc-btn__well"><X /></span>
          Cancel
        </button>
        <button
          type="button" className="irc-btn irc-btn--go"
          disabled={idle || busy}
          onClick={() => onTake(pick)}
        >
          <span className="irc-btn__well"><Circle strokeWidth={3} /></span>
          {busy ? 'Applying...' : idle ? 'MAKE A CHOICE!' : 'Import'}
        </button>
      </div>
    </AppModal>
  )
}
