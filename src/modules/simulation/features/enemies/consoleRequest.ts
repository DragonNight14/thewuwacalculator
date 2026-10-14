/*
  Author: Runor Ewhro
  description: keeps the target-console request available to app chrome
               without loading the console or calculation engine.
*/

import { create } from 'zustand'

interface EnemyConsoleStore {
  open: boolean
  show: () => void
  close: () => void
}

export const useEnemyCnsl = create<EnemyConsoleStore>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}))

export function openEnemyCnsl(): void {
  useEnemyCnsl.getState().show()
}
