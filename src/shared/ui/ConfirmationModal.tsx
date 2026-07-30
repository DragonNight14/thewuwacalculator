/*
  Author: Runor Ewhro
  Description: Shared confirmation dialog for important or destructive choices.
               Presents a centered emblem "seal": two doors for a yes/no, or a
               stacked list when a third (secondary) choice is offered.
*/

import type { ReactNode } from 'react'
import { AlertTriangle as AlertIcon, Info } from 'lucide-react'
import { AppModal } from '@/shared/ui/AppModal'

interface CnfrMdlPrps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  secondaryLabel?: string
  confirmDisabled?: boolean
  confirmTitle?: string
  variant?: 'info' | 'danger'
  onConfirm: () => void
  onSecondary?: () => void
  onCancel: () => void
}

export function CnfrMdl({
  visible,
  open,
  closing = false,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  secondaryLabel,
  confirmDisabled = false,
  confirmTitle,
  variant = 'info',
  onConfirm,
  onSecondary,
  onCancel,
}: CnfrMdlPrps) {
  const Icon = variant === 'danger' ? AlertIcon : Info
  const hasSecondary = Boolean(secondaryLabel && onSecondary)

  const confirmBtn = (
    <button
      type="button"
      className={`confirmation-modal__door confirmation-modal__door--go${variant === 'danger' ? ' confirmation-modal__door--danger' : ''}`}
      onClick={onConfirm}
      disabled={confirmDisabled}
      title={confirmTitle}
    >
      {confirmLabel}
    </button>
  )
  const cancelBtn = (
    <button
      type="button"
      className="confirmation-modal__door confirmation-modal__door--cancel"
      onClick={onCancel}
    >
      {cancelLabel}
    </button>
  )

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="confirmation"
      tone={variant}
      ariaLabel={title}
      onClose={onCancel}
    >
      <div className="confirmation-modal__seal">
        <span className="confirmation-modal__medal">
          <Icon size="1.35rem" />
        </span>
        <h2 className="confirmation-modal__title">{title}</h2>
        <div className="confirmation-modal__message">{message}</div>
      </div>
      <div
        className={`confirmation-modal__doors${hasSecondary ? ' confirmation-modal__doors--stack' : ''}`}
      >
        {hasSecondary ? (
          <>
            {confirmBtn}
            <button
              type="button"
              className="confirmation-modal__door confirmation-modal__door--secondary"
              onClick={onSecondary}
            >
              {secondaryLabel}
            </button>
            {cancelBtn}
          </>
        ) : (
          <>
            {cancelBtn}
            {confirmBtn}
          </>
        )}
      </div>
    </AppModal>
  )
}
