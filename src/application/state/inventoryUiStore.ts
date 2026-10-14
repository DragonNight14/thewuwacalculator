/*
  Author: Runor Ewhro
  description: stores session-only inventory visibility, mounting, and query state.
*/

import { create } from 'zustand'

interface InventoryUiStore {
  open: boolean
  mounted: boolean
  echoQuery: string
  setOpen: (open: boolean) => void
  setEchoQuery: (query: string) => void
}

export const useInventoryUiStore = create<InventoryUiStore>((set) => ({
  open: false,
  mounted: false,
  echoQuery: '',
  setOpen: (open) => set((state) => ({ open, mounted: state.mounted || open })),
  setEchoQuery: (echoQuery) => set({ echoQuery }),
}))
