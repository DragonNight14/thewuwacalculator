/*
  Author: Runor Ewhro
  description: coordinates controlled selection and grid/filter page state for
               mobile picker dialogs.
*/

import { useId, useRef, useState } from 'react'
import { ChevronLeft, SlidersHorizontal, X } from 'lucide-react'
import { AppModal } from '@/shared/ui/AppModal'
import { PickerCard, useDeferredImages } from '@/modules/simulation/ui/PickerModal.tsx'
import type { PckrMdlPrps } from '@/modules/simulation/ui/PickerModal.tsx'

export function MobilePickerModal({
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
  onClose,
}: PckrMdlPrps) {
  const titleId = useId()
  const gridRef = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState<'grid' | 'filters'>('grid')

  useDeferredImages(gridRef, visible && page === 'grid', items)

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setPage('grid')
  }

  if (!visible || !portalTarget) return null

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="picker"
      ariaLabelBy={titleId}
      onClose={onClose}
    >
      <div className="amdl mpk mpg-native" data-variant={variant} data-page={page} onClick={(event) => event.stopPropagation()}>
        <header className="mpk-head">
          <span className="mpk-title">
            {eyebrow ? <span className="mpk-over">{eyebrow}</span> : null}
            <h2 id={titleId}>{title}</h2>
          </span>
          {summary ? <div className="mpk-summary">{summary}</div> : null}
          <button type="button" className="mpk-close" aria-label={closeLabel} onClick={onClose}>
            <X size={14} />
          </button>
        </header>

        {filters ? (
          <div className="mpk-bar">
            {page === 'grid' ? (
              <>
                <span className="mpk-count">{railFoot}</span>
                <button type="button" className="mpk-btn" onClick={() => setPage('filters')}>
                  <SlidersHorizontal size={15} />
                  Filters
                </button>
              </>
            ) : (
              <button type="button" className="mpk-btn is-back" onClick={() => setPage('grid')}>
                <ChevronLeft size={16} />
                Show {railFoot ?? 'results'}
              </button>
            )}
          </div>
        ) : null}

        <div className="mpk-pages">
          <div className="mpk-page mpk-grid-page" ref={gridRef} aria-hidden={page !== 'grid'} inert={page !== 'grid'}>
            {items.length === 0 ? (
              <div className="mpk-empty">{emptyState ?? <p>Nothing matches. Clear a filter to see more.</p>}</div>
            ) : (
              <div className="mpk-grid">
                {items.map((item) => <PickerCard key={item.id} item={item} />)}
              </div>
            )}
          </div>

          {filters ? (
            <nav className="mpk-page mpk-filters pkr-rail" aria-label="Filters" aria-hidden={page !== 'filters'} inert={page !== 'filters'}>
              {filters}
            </nav>
          ) : null}
        </div>
      </div>
    </AppModal>
  )
}
