/*
  Author: Runor Ewhro
  description: coordinates modal visible, open, closing, payload, and delayed-unmount state transitions.
*/

import { useCallback, useMemo, useState } from 'react'
import { useAnimatedModalValue, useAnimatedVisibility } from '@/shared/hooks/useAnimatedVisibility'
import type { AppModalState } from '@/shared/ui/AppModal'

export const MODAL_EXIT_MS = 320
// publish the open phase after mount so dialog refs exist before focus handling.
const MODAL_OPEN_DELAY = 1

function getDialogProps(state: AppModalState): AppModalState {
  return {
    visible: state.visible,
    open: state.open,
    closing: state.closing,
  }
}

export function useAppModal() {
  const modal = useAnimatedVisibility(MODAL_EXIT_MS, MODAL_OPEN_DELAY)

  return useMemo(() => ({
    ...modal,
    dialogProps: getDialogProps(modal),
  }), [modal])
}

export function useAppModalValue<T>() {
  const modal = useAnimatedModalValue<T>(MODAL_EXIT_MS, MODAL_OPEN_DELAY)

  return useMemo(() => ({
    ...modal,
    dialogProps: getDialogProps(modal),
  }), [modal])
}

export function useResetModalValue<T>(
  initialValue: T,
  resetValue: (next: T) => void,
) {
  const [value, setValue] = useState<T>(initialValue)
  const modal = useAppModal()

  const show = useCallback((nextValue: T) => {
    // reset both local and external drafts before publishing the open state.
    resetValue(nextValue)
    setValue(nextValue)
    modal.show()
  }, [modal, resetValue])

  return useMemo(() => ({
    ...modal,
    show,
    value,
  }), [modal, show, value])
}
