/*
  Author: Runor Ewhro
  description: gates beta acknowledgement behind a timed countdown, records
               daily confirmation, and delays unmount through modal exit.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { FlaskConical, TimerReset } from 'lucide-react'
import { AppModal } from '@/shared/ui/AppModal'
import { ModalShell } from '@/shared/ui/AppModalShell'
import { MODAL_EXIT_MS } from '@/shared/ui/useAppModal'
import {
  acknowledgeBetaNotice,
  isBetaNoticeAcknowledgedToday,
} from '@/infra/persistence/betaNotice'

const NOTICE_DELAY_MS = 10000
const COUNTDOWN_TICK_MS = 100

function countdownLabel(seconds: number) {
  return `${seconds} second${seconds === 1 ? '' : 's'}`
}

export function BetaNoticeModal() {
  const unlockAtRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(NOTICE_DELAY_MS / 1000)
  const [canConfirm, setCanConfirm] = useState(false)
  const [closing, setClosing] = useState(false)
  const [dismissed, setDismissed] = useState(isBetaNoticeAcknowledgedToday)

  useEffect(() => {
    if (dismissed) return

    const unlockAt = performance.now() + NOTICE_DELAY_MS
    unlockAtRef.current = unlockAt

    const updateCountdown = () => {
      const remaining = Math.max(0, unlockAt - performance.now())
      setSecondsLeft(Math.ceil(remaining / 1000))

      if (remaining === 0) {
        setCanConfirm(true)
        window.clearInterval(interval)
      }
    }

    const interval = window.setInterval(updateCountdown, COUNTDOWN_TICK_MS)

    return () => {
      window.clearInterval(interval)
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
      }
      unlockAtRef.current = null
    }
  }, [dismissed])

  const confirm = useCallback(() => {
    const unlockAt = unlockAtRef.current
    if (!canConfirm || unlockAt === null || performance.now() < unlockAt) {
      return
    }

    acknowledgeBetaNotice()
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      setDismissed(true)
      closeTimerRef.current = null
    }, MODAL_EXIT_MS)
  }, [canConfirm])

  if (dismissed) {
    return null
  }

  return (
    <AppModal
      state={{ visible: true, open: !closing, closing }}
      variant="beta-notice"
      ariaLabel="Welcome to the UI beta"
      ariaDscrBy="beta-notice-description"
      dismissible={false}
      onClose={() => undefined}
    >
      <ModalShell className="bnm__frame">
        <header className="amdl__head">
          <span className="amdl__lead bnm__lead" aria-hidden="true">
            <FlaskConical />
          </span>
          <span className="amdl__title">
            <span className="amdl__over">Public preview</span>
            <h2 id="beta-notice-title">Hewo~!</h2>
          </span>
          <span className="amdl__fill" />
          <span
            id="beta-notice-countdown"
            className={`amdl__tag bnm__countdown${canConfirm ? ' is-accent' : ''}`}
            aria-live="polite"
          >
            <TimerReset aria-hidden="true" />
            {canConfirm ? 'Ready' : countdownLabel(secondsLeft)}
          </span>
        </header>

        <div className="amdl__pane bnm__body">
          <div id="beta-notice-description" className="amdl__prose bnm__intro">
            <p>Hey everyone, thank you for using the beta app, it's days are numbered as i think i'm done with everything rn.</p>
            <p>Your feedback is still appreciated but unless anything crazy happens, this is most likely what you're gonna see on the live app real soon.</p>
            <p>As usual, if you do find something that seems broken, please let me know on the discord, if you aren't on the discord... oh well, sucks to suck i guess, i can't read your mind.</p>
            <p>Well... i will update the "What's New" section, the changelog, etc, but other than that, there's nothing more to expect.</p>
            <p>
              This is an early preview intended to help shape the new experience. Expect parts of
              it to change while the beta is public.
            </p>
          </div>

          <section className="amdl__grp" aria-labelledby="beta-notice-before-title">
            <h3 id="beta-notice-before-title" className="amdl__grp-name">
              Before you continue
            </h3>
            <ul className="bnm__points">
              <li>The guides have been restructured and are now more illustrative (and helpful hopefully). Please look at them..</li>
              <li>Backend-dependent features, saved data, and shared links may be unavailable or reset.</li>
              <li>Results and workflows in this preview should not be treated as production-ready.</li>
            </ul>
          </section>
        </div>

        <footer className="amdl__foot">
          <button
            type="button"
            className="amdl__act is-go bnm__confirm"
            onClick={confirm}
            disabled={!canConfirm}
            aria-describedby="beta-notice-countdown"
          >
            I understand
          </button>
        </footer>
      </ModalShell>
    </AppModal>
  )
}
