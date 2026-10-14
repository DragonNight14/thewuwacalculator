/*
  Author: Runor Ewhro
  description: wraps the shared radix dialog primitives with the app's portal,
               overlay, and outside-interaction safeguards.
*/

import * as Dialog from '@radix-ui/react-dialog'
import { VisuallyHidden as VsllHddn } from '@radix-ui/react-visually-hidden'
import { useLayoutEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'

interface AppDlgPrps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  contentClass?: string
  contentStyle?: CSSProperties
  ariaLabel?: string
  ariaLabelBy?: string
  ariaDscrBy?: string
  dismissible?: boolean
  onClose: () => void
  children: ReactNode
}

function isFltnSelCtn(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('.sfa'))
}

function isAppPopup(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('.app-popup'))
}

// preserve the primitive's focus-candidate order while deferring the layout read.
const FOCUS_CANDIDATES = [
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'button',
  'a[href]',
  '[tabindex]',
].map((selector) => `${selector}:not([disabled]):not([tabindex="-1"]):not([aria-hidden="true"])`).join(',')

function focusFirst(content: HTMLElement) {
  const candidates = content.querySelectorAll<HTMLElement>(FOCUS_CANDIDATES)
  for (const candidate of candidates) {
    if (candidate.offsetWidth || candidate.offsetHeight || candidate.getClientRects().length) {
      candidate.focus({ preventScroll: true })
      if (document.activeElement === candidate) return
    }
  }

  content.focus({ preventScroll: true })
}

// restrict layout invalidation during the opening transition, then remove
// containment before descendants can position anchored popups against the page.
const ARRIVAL_MS = 760

function useArrival(open: boolean) {
  const contentRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content || !open) return

    content.dataset.arriving = 'true'
    const land = () => content.removeAttribute('data-arriving')
    const timer = window.setTimeout(land, ARRIVAL_MS)
    // pointer interaction may open an anchored popup before the timer settles.
    content.addEventListener('pointerdown', land, { once: true })
    return () => {
      window.clearTimeout(timer)
      content.removeEventListener('pointerdown', land)
      land()
    }
  }, [open])

  return contentRef
}

export function AppDialog({
  visible,
  open,
  closing = false,
  portalTarget,
  contentClass: contentClass,
  contentStyle,
  ariaLabel,
  ariaLabelBy: ariaLabelBy,
  ariaDscrBy: ariaDscrBy,
  dismissible = true,
  onClose,
  children,
}: AppDlgPrps) {
  const contentRef = useArrival(open)

  if (!visible || !portalTarget) {
    return null
  }

  const vrlyClssNms = ['app-modal-overlay', open ? 'open' : '', closing ? 'closing' : '']
    .filter(Boolean)
    .join(' ')
  const cntnClssNms = [contentClass, open ? 'open' : '', closing ? 'closing' : '']
    .filter(Boolean)
    .join(' ')
  // backdrop filtering stays outside the scrolling subtree; each frame reuses it.
  const blurClssNms = ['app-modal-blur', open ? 'open' : '', closing ? 'closing' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && dismissible) {
        onClose()
      }
    }}>
      <Dialog.Portal forceMount container={portalTarget}>
        <div className={blurClssNms} aria-hidden="true" />
        <Dialog.Overlay
          forceMount
          className={vrlyClssNms}
          data-app-modal-overlay="true"
        >
          <Dialog.Content
            forceMount
            ref={contentRef}
            className={cntnClssNms}
            style={contentStyle}
            data-app-modal-content="true"
            aria-label={ariaLabel}
            onOpenAutoFocus={(event) => {
              // defer focus until the mounted dialog has its own layout boundary.
              event.preventDefault()
              const content = event.currentTarget ?? event.target
              if (!(content instanceof HTMLElement)) return
              window.requestAnimationFrame(() => {
                if (content.isConnected) focusFirst(content)
              })
            }}
            aria-labelledby={ariaLabelBy}
            aria-describedby={ariaDscrBy}
            onEscapeKeyDown={(event) => {
              if (!dismissible) {
                event.preventDefault()
              }
            }}
            onInteractOutside={(event) => {
              if (!dismissible) {
                event.preventDefault()
                return
              }

              // nested popups and selection actions are not outside-dialog interactions.
              if (
                isAppPopup(event.target)
                || isFltnSelCtn(event.target)
              ) {
                event.preventDefault()
              }
            }}
          >
            <VsllHddn>
              <Dialog.Title>{ariaLabel ?? 'Dialog'}</Dialog.Title>
            </VsllHddn>
            {ariaDscrBy ? null : (
              <VsllHddn>
                <Dialog.Description />
              </VsllHddn>
            )}
            {children}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
