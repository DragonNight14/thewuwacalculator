/*
  Author: Runor Ewhro
  description: renders reference and legal navigation on every route.
*/

import { useRef } from 'react'
import type { ComponentType } from 'react'
import {
  BookOpen,
  FileText,
  History,
  Scale,
  Shield,
  Settings as SttngsGlyph,
} from 'lucide-react'
import { AnchoredAppPopup, useAppPopupDismiss } from '@/shared/ui/AppPopup'
import { APP_NAVIGATION } from '@/shared/lib/appRoutes'
import { AxLink } from '@/shared/navigation/useNavX'
import { READ_PAGES } from '@/application/navigation/appIndex'

const REF_GLYPHS: Record<string, ComponentType<{ size?: string, 'aria-hidden'?: boolean }>> = {
  Docs: FileText,
  Guides: BookOpen,
  Changelog: History,
  Calibration: SttngsGlyph,
}

const LEGAL_PAGES = [
  { ...APP_NAVIGATION.privacy, Glyph: Shield },
  { ...APP_NAVIGATION.terms, Glyph: Scale },
]

interface AppDrawerProps {
  open: boolean
  onToggle: () => void
  onClose: () => void
}

export function AppDrawer({ open, onToggle, onClose }: AppDrawerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)

  useAppPopupDismiss({
    open,
    onDismiss: onClose,
    hostRef,
    popupRef,
    returnFocusRef: triggerRef,
    pointerEvent: 'mousedown',
  })

  return (
    <div className="ax-drop-holder" ref={hostRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`ax-drop${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open Read"
        onClick={onToggle}
      >
        Read
        <span className="ax-drop__caret" aria-hidden="true" />
      </button>

      <AnchoredAppPopup
        visible={open}
        anchorRef={triggerRef}
        popupRef={popupRef}
        portalClassName="ax-menu"
        align="end"
        maxHeight={560} className="app-popup--chrome ax-pop--menu"
        open={open}
        role="menu"
      >
        <div className="ax-grp">
          <p className="ax-grp-lbl">Read</p>

          {READ_PAGES.map((reference) => {
            const Glyph = REF_GLYPHS[reference.name] ?? FileText

            return (
              <AxLink className="ax-item"
                role="menuitem"
                key={reference.name}
                to={reference.to}
                onClick={onClose}
              >
                <Glyph size="1rem" aria-hidden={true} />
                <span>{reference.name}</span>
              </AxLink>
            )
          })}
        </div>

        <div className="ax-grp">
          <p className="ax-grp-lbl">Legal</p>
          {LEGAL_PAGES.map(({ name, to, Glyph }) => (
            <AxLink className="ax-item" role="menuitem" key={to} to={to} onClick={onClose}>
              <Glyph size="1rem" aria-hidden="true" />
              <span>{name}</span>
            </AxLink>
          ))}
        </div>
      </AnchoredAppPopup>
    </div>
  )
}
