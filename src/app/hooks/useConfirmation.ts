/*
  Author: Runor Ewhro
  Description: Exposes a small confirmation-dialog controller so callers can
               request confirm flows without owning the modal state directly.
*/

import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { useAppMdlVl } from '@/shared/ui/useAppModal'

interface CnfrStt {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  // Secondary is a distinct commit path, not a second cancel path; callers use
  // it when the same prompt can complete through two valid mutations.
  secondaryLabel?: string
  variant?: 'info' | 'danger'
  onConfirm: () => void
  onSecondary?: () => void
}

export function useCnfr() {
  const modal = useAppMdlVl<CnfrStt>()

  const onCnfr = useCallback(() => {
    modal.value?.onConfirm()
    modal.hide()
  }, [modal])

  const onScnd = useCallback(() => {
    modal.value?.onSecondary?.()
    modal.hide()
  }, [modal])

  return {
    visible: modal.visible,
    open: modal.open,
    closing: modal.closing,
    title: modal.value?.title ?? '',
    message: modal.value?.message ?? '',
    confirmLabel: modal.value?.confirmLabel,
    cancelLabel: modal.value?.cancelLabel,
    secondaryLabel: modal.value?.secondaryLabel,
    variant: modal.value?.variant,
    confirm: modal.show,
    onConfirm: onCnfr,
    onSecondary: modal.value?.onSecondary ? onScnd : undefined,
    onCancel: modal.hide,
  }
}
