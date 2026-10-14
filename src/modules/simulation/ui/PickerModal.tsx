/*
  Author: Runor Ewhro
  description: provides searchable, grouped modal selection with keyboard focus and active-item scrolling.
*/

import { useEffect, useId, useRef } from 'react'
import type { CSSProperties as CssProps, ReactNode, RefObject } from 'react'
import { AppModal } from '@/shared/ui/AppModal'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import { rarityVars } from '@/modules/simulation/model/display.ts'
import { usePickerMotion } from '@/modules/simulation/ui/pickerMotion.ts'
import { observeDisplayImage } from '@/shared/lib/displayImageSizing'
import { useMobileUi } from '@/shared/responsive/mobileUi'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger'
import { Check } from 'lucide-react'
import { MobilePickerModal } from '@/modules/simulation/ui/mobile/MobilePickerModal.tsx'

export type PckrMdlRrty = 1 | 2 | 3 | 4 | 5

export interface PckrMdlItem {
  id: string
  title: string
  subtitle?: string
  rarity?: PckrMdlRrty
  tone?: string
  leading?: ReactNode
  trailing?: ReactNode
  cornerNote?: ReactNode
  meta?: ReactNode
  selected?: boolean
  disabled?: boolean
  bis?: boolean
  onSelect: () => void
}

export interface PckrMdlPrps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  variant?: string
  title: string
  eyebrow?: string
  description?: string
  summary?: ReactNode
  filters?: ReactNode
  railFoot?: ReactNode
  items: PckrMdlItem[]
  emptyState?: ReactNode
  closeLabel?: string
  panelWidth?: 'regular' | 'wide'
  onClose: () => void
}

export function PickerModal(props: PckrMdlPrps) {
  return useMobileUi() ? <MobilePickerModal {...props} /> : <DesktopPickerModal {...props} />
}

function DesktopPickerModal({
  visible,
  open,
  closing = false,
  portalTarget,
  variant,
  title,
  eyebrow,
  summary,
  filters,
  railFoot,
  items,
  emptyState,
  closeLabel = 'Close',
  panelWidth = 'regular',
  onClose,
}: PckrMdlPrps) {
  const titleId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)

  useDeferredImages(bodyRef, visible, items)
  usePickerEntrance(bodyRef, visible)
  const capture = usePickerMotion(bodyRef)

  if (!visible || !portalTarget) {
    return null
  }

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="picker"
      size={panelWidth}
      ariaLabelBy={titleId}
      onClose={onClose}
    >
      <div className="amdl pkm__frame" data-variant={variant} onClick={(event) => event.stopPropagation()}>
        <ModalHeader
          over={eyebrow}
          title={<h2 id={titleId}>{title}</h2>}
          closeLabel={closeLabel}
          onClose={onClose}
        >
          {summary ? <div className="amdl__gauge" onClickCapture={capture}>{summary}</div> : null}
        </ModalHeader>

        <div className={`pkm__stage ${filters ? 'has-rail' : ''}`}>
          {filters ? (
            <nav className="amdl__rail pkr-rail" aria-label="Filters" onClickCapture={capture} onChangeCapture={capture}>
              {filters}
              {railFoot ? <div className="amdl__rail-foot">{railFoot}</div> : null}
            </nav>
          ) : null}

          <div className="pkm__body" ref={bodyRef}>
            {items.length === 0 ? (
              <div className="pkm__empty">
                {emptyState ?? <p>No items available.</p>}
              </div>
            ) : (
              <div className="pkm__grid pkm__grid--cards">
                {items.map((item) => (
                  <PickerCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppModal>
  )
}

// measure mounted visible rows once and animate them directly. this avoids
// registering css animation events for offscreen cards at the dialog root.
const ENTER_ROW_STEP = 55
const ENTER_MS = 350
const ENTER_EASE = 'ease'

function calmMotion() {
  const flags = document.documentElement.classList
  return flags.contains('reduce-animation') || flags.contains('no-entrance-anim')
}

export function usePickerEntrance(bodyRef: RefObject<HTMLElement | null>, visible: boolean) {
  useEffect(() => {
    const body = bodyRef.current
    if (!visible || !body || calmMotion()) return

    let frame: number | null = window.requestAnimationFrame(() => {
      frame = null
      // layout-delta motion starts after the first picker mutation.
      if (body.closest('.pkm__frame')?.classList.contains('is-live')) return

      const view = body.getBoundingClientRect()
      const rows = new Map<number, HTMLElement[]>()
      body.querySelectorAll<HTMLElement>('.pkm__grid > *').forEach((card) => {
        const rect = card.getBoundingClientRect()
        if (rect.top > view.bottom || rect.bottom < view.top) return
        const row = Math.round(rect.top)
        const seats = rows.get(row)
        if (seats) seats.push(card)
        else rows.set(row, [card])
      })

      const ordered = [...rows.keys()].sort((first, second) => first - second)
      for (const [index, row] of ordered.entries()) {
        for (const card of rows.get(row)!) {
          card.animate(
            [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
            { duration: ENTER_MS, delay: index * ENTER_ROW_STEP, easing: ENTER_EASE, fill: 'backwards' },
          )
        }
      }
    })

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [bodyRef, visible])
}

// observe the modal scroll root. request deferred card images as each card
// enters the active picker body.
export function useDeferredImages(bodyRef: RefObject<HTMLElement | null>, visible: boolean, refreshKey: unknown) {
  useEffect(() => {
    const body = bodyRef.current
    if (!visible || !body) return
    const images = body.querySelectorAll<HTMLImageElement>('img[data-deferred-src]')
    if (!images.length) return
    const cleanups = new Map<HTMLImageElement, () => void>()
    const load = (image: HTMLImageElement) => {
      const source = image.dataset.deferredSrc
      if (!source || cleanups.has(image)) return
      image.decoding = 'async'
      cleanups.set(image, observeDisplayImage(image, source))
    }
    if (typeof IntersectionObserver === 'undefined') {
      images.forEach(load)
      return () => cleanups.forEach((cleanup) => cleanup())
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        load(entry.target as HTMLImageElement)
        observer.unobserve(entry.target)
      }
    // begin loading one row before intersection to hide decode latency.
    }, { root: body, rootMargin: '220px 0px' })
    images.forEach((image) => {
      if (!image.getAttribute('src')) observer.observe(image)
      else load(image)
    })
    return () => {
      observer.disconnect()
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [bodyRef, visible, refreshKey])
}

export function PickerCard({
  item,
  art,
  className = '',
}: {
  item: PckrMdlItem
  art?: ReactNode
  className?: string
}) {
  return (
    <ContextTrigger
      asChild
      ariaLabel={`${item.title} picker actions`}
      items={[{
        id: `picker:${item.id}:select`,
        label: `Select ${item.title}`,
        icon: <Check size="1em" />,
        disabled: item.disabled || item.selected,
        onSelect: item.onSelect,
      }]}
    >
    <button
      type="button"
      className={`pkm__card ${item.selected ? 'is-selected' : ''} ${!item.leading ? 'pkm__card--plain' : ''} ${className}`}
      style={{
        ...rarityVars(item.rarity, item.bis),
        ...(item.tone ? { '--picker-item-tone': item.tone } : null),
      } as CssProps}
      aria-pressed={item.selected}
      data-bis={item.bis ? 'true' : undefined}
      data-pick-id={item.id}
      onClick={item.onSelect}
      disabled={item.disabled}
    >
      {item.leading ? (
        <div className="pkm__card-art">
          {item.leading}
          {item.cornerNote ? <div className="pkm__card-flag pkm__card-flag--left">{item.cornerNote}</div> : null}
          {item.trailing ? <div className="pkm__card-flag">{item.trailing}</div> : null}
          {art}
        </div>
      ) : null}

      <div className="pkm__card-cap">
        <div className="pkm__card-title">{item.title}</div>
        {item.subtitle ? <div className="pkm__card-subtitle">{item.subtitle}</div> : null}
        {item.meta ? (
          <div className="pkm__card-spec">{item.meta}</div>
        ) : null}
      </div>
    </button>
    </ContextTrigger>
  )
}
