/*
  Author: Runor Ewhro
  Description: Shared radix-tooltip wrapper with app-level defaults for delay,
               placement, and close timing.
*/

import React from 'react'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import type {
  FocusEvent as RctFcsVnt,
  MouseEvent as RctMsVnt,
  ReactNode,
} from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAnimVis } from '@/app/hooks/useAnimatedVisibility'
import { bodyPortal } from '@/shared/lib/portalTarget'

export interface TooltipProps {
  children: ReactNode
  content: ReactNode
  placement?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
  delay?: number
}

const TLTPCLSDURMS = 180

export function AppTltpProv({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={140} skipDelayDuration={120} disableHoverableContent>
      {children}
    </RadixTooltip.Provider>
  )
}

export const Tooltip: React.FC<TooltipProps> = ({
  children,
  content,
  placement = 'top',
  className = '',
  delay = 200,
}) => {
  const [open, setOpen] = React.useState(false)
  const [present, setPresent] = React.useState(false)
  const [closing, setClosing] = React.useState(false)
  const clsTmrRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (clsTmrRef.current !== null) {
        window.clearTimeout(clsTmrRef.current)
      }
    }
  }, [])

  const syncPresence = React.useCallback((nextOpen: boolean) => {
    if (clsTmrRef.current !== null) {
      window.clearTimeout(clsTmrRef.current)
      clsTmrRef.current = null
    }

    if (nextOpen) {
      setPresent(true)
      setClosing(false)
      setOpen(true)
      return
    }

    setOpen(false)
    setPresent(true)
    setClosing(true)
    clsTmrRef.current = window.setTimeout(() => {
      setPresent(false)
      setClosing(false)
      clsTmrRef.current = null
    }, TLTPCLSDURMS)
  }, [])

  const changeOpen = (nextOpen: boolean) => {
    syncPresence(nextOpen)
  }

  return (
    <RadixTooltip.Root
      open={open}
      onOpenChange={changeOpen}
      delayDuration={delay}
      disableHoverableContent
    >
      <RadixTooltip.Trigger asChild>
        <span className={`tooltip-trigger ${className}`.trim()} style={{ display: 'inline-flex' }}>
          {children}
        </span>
      </RadixTooltip.Trigger>
      {present ? (
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            forceMount
            side={placement}
            sideOffset={8}
            collisionPadding={12}
            className={`app-tooltip-container radix-tooltip-content ${closing ? 'is-closing' : 'is-opening'}`.trim()}
            style={{ zIndex: 99999 }}
          >
            <div className="app-tooltip-content">{content}</div>
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      ) : null}
    </RadixTooltip.Root>
  )
}

const HC_CRSR_OFFSET_X = 18
const HC_CRSR_OFFSET_Y = 20
const HC_VWPRT_PAD = 12
const HC_EXIT_MS = 200

export interface HoverCardProps {
  // The trigger remains mounted permanently; hover/focus handlers are attached
  // to the wrapper instead of mutating the child.
  children: ReactNode
  // A function defers expensive catalog lookup/formatting until the first
  // visible frame instead of paying it during the parent render.
  content: ReactNode | (() => ReactNode)
  // Disabled instances skip portal and pointer work while preserving trigger layout.
  disabled?: boolean
  label?: string
  // Class hooks are split so caller skins can target trigger, portal root, and
  // measured card independently of the shared placement mechanics.
  triggerClassName?: string
  rootClassName?: string
  cardClassName?: string
  offsetX?: number
  offsetY?: number
  exitMs?: number
}

// The card is lazily mounted, placed from the latest pointer position, and
// clamped/flipped inside the viewport; callers provide only trigger/content and
// optional classes.
export function HoverCard({
  children,
  content,
  disabled = false,
  label,
  triggerClassName,
  rootClassName,
  cardClassName,
  offsetX = HC_CRSR_OFFSET_X,
  offsetY = HC_CRSR_OFFSET_Y,
  exitMs = HC_EXIT_MS,
}: HoverCardProps) {
  const visibility = useAnimVis(exitMs)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)

  const portalTarget = bodyPortal()

  const applyPlacement = useCallback((clientX: number, clientY: number) => {
    const root = rootRef.current
    const card = cardRef.current
    if (!root || !card) return

    const width = card.offsetWidth
    const height = card.offsetHeight

    // Default below-right of the cursor, then flip toward whichever side keeps
    // the whole card inside the viewport.
    let x = clientX + offsetX
    let y = clientY + offsetY

    if (x + width + HC_VWPRT_PAD > window.innerWidth) {
      x = clientX - width - offsetX
    }
    if (y + height + HC_VWPRT_PAD > window.innerHeight) {
      y = clientY - height - offsetY
    }

    x = Math.min(Math.max(HC_VWPRT_PAD, x), window.innerWidth - width - HC_VWPRT_PAD)
    y = Math.min(Math.max(HC_VWPRT_PAD, y), window.innerHeight - height - HC_VWPRT_PAD)

    root.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }, [offsetX, offsetY])

  const schedulePlacement = useCallback(() => {
    if (frameRef.current !== null) return
    // Mousemove can fire faster than layout can settle; one rAF keeps placement
    // measurements current without forcing sync work on every pointer event.
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      const pointer = pointerRef.current
      if (pointer) applyPlacement(pointer.x, pointer.y)
    })
  }, [applyPlacement])

  const clearFrame = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  const onEnter = useCallback((event: RctMsVnt<HTMLSpanElement>) => {
    if (disabled) return
    pointerRef.current = { x: event.clientX, y: event.clientY }
    visibility.show()
  }, [disabled, visibility])

  const onMove = useCallback((event: RctMsVnt<HTMLSpanElement>) => {
    if (!visibility.visible) return
    pointerRef.current = { x: event.clientX, y: event.clientY }
    schedulePlacement()
  }, [schedulePlacement, visibility.visible])

  const onLeave = useCallback(() => {
    visibility.hide()
  }, [visibility])

  const onFocus = useCallback((event: RctFcsVnt<HTMLSpanElement>) => {
    if (disabled) return
    const rect = event.currentTarget.getBoundingClientRect()
    pointerRef.current = { x: rect.left, y: rect.bottom }
    visibility.show()
  }, [disabled, visibility])

  useLayoutEffect(() => {
    if (!visibility.visible) return
    const pointer = pointerRef.current
    if (pointer) applyPlacement(pointer.x, pointer.y)
  }, [applyPlacement, visibility.visible])

  useEffect(() => clearFrame, [clearFrame])

  return (
    <>
      <span
        className={triggerClassName ? `hover-card__trigger ${triggerClassName}` : 'hover-card__trigger'}
        aria-label={label}
        tabIndex={disabled ? undefined : 0}
        onMouseEnter={onEnter}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onFocus={onFocus}
        onBlur={onLeave}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onLeave()
        }}
      >
        {children}
      </span>

      {visibility.visible && portalTarget
        ? createPortal(
            <div
              ref={rootRef}
              className={rootClassName ? `hover-card ${rootClassName}` : 'hover-card'}
              data-open={visibility.open ? 'true' : undefined}
              data-closing={visibility.closing ? 'true' : undefined}
              role="presentation"
            >
              <div
                ref={cardRef}
                className={cardClassName ? `hover-card__card ${cardClassName}` : 'hover-card__card'}
              >
                {typeof content === 'function' ? content() : content}
              </div>
            </div>,
            portalTarget,
          )
        : null}
    </>
  )
}

interface DmgTltpPrps {
  label: string
  metric: 'normal' | 'crit' | 'avg'
  formula?: string
}

export const DmgTltp: React.FC<DmgTltpPrps> = ({ label, metric, formula }) => {
  return (
    <div className="trace-node-tooltip damage-tooltip-wrapper">
      <div className="tooltip-header">
        <div className="tooltip-title">{label}</div>
      </div>

      {formula && (
        <div className="tooltip-section">
          <code className="formula-code">{`out.${metric} = ${formula}`}</code>
        </div>
      )}
    </div>
  )
}
