/*
  Author: Runor Ewhro
  description: stores app-header echo import requests without changing the active resonator.
*/

import { create } from 'zustand'

interface EchoImportState {
  isOpen: boolean
  initialResonatorId: string | null
  requestId: number
  open: (resonatorId?: string | null) => void
  close: () => void
}

export const useEchoImport = create<EchoImportState>((set) => ({
  isOpen: false,
  initialResonatorId: null,
  requestId: 0,
  open: (resonatorId = null) => set((state) => ({
    isOpen: true,
    initialResonatorId: resonatorId,
    requestId: state.requestId + 1,
  })),
  close: () => set({ isOpen: false }),
}))

export function openEchoImport(resonatorId?: string | null): void {
  useEchoImport.getState().open(resonatorId)
}

export function useEchoImportRequested(): boolean {
  return useEchoImport((state) => state.isOpen)
}
