/*
  Author: Runor Ewhro
  Description: holds the open teammate console request so the team pane and the
               toolbar summary open the same modal from anywhere in the shell.
*/

import { create } from 'zustand'
import type { ChannelId } from '@/modules/calculator/features/teams/ConfigModal.tsx'

interface ConsoleTarget {
  resonatorId: string
  channel: ChannelId
}

interface TeamConsoleStore {
  target: ConsoleTarget | null
  open: (resonatorId: string, channel?: ChannelId) => void
  switchMember: (resonatorId: string) => void
  setChannel: (channel: ChannelId) => void
  close: () => void
}

// the request is deliberately session-only: a console left open at unload
// should not reopen on the next visit.
export const useTeamCnsl = create<TeamConsoleStore>((set) => ({
  target: null,
  open: (resonatorId, channel = 'loadout') => set({ target: { resonatorId, channel } }),
  switchMember: (resonatorId) => set((state) => (
    state.target ? { target: { ...state.target, resonatorId } } : state
  )),
  setChannel: (channel) => set((state) => (
    state.target ? { target: { ...state.target, channel } } : state
  )),
  close: () => set({ target: null }),
}))

export function openTeamCnsl(resonatorId: string, channel: ChannelId = 'loadout') {
  useTeamCnsl.getState().open(resonatorId, channel)
}
