/*
  Author: Runor Ewhro
  description: maps member-console stage and channel identifiers to controlled
               mobile page selection.
*/

import type { ReactNode } from 'react'
import { UserRound } from 'lucide-react'

export type ConsolePage = 'stage' | 'channel'

interface MobileConsoleBarP<Id extends string> {
  name: string
  channels: Array<{ id: Id, label: string, icon: ReactNode }>
  channel: Id
  page: ConsolePage
  badges: Partial<Record<Id, number>>
  onStage: () => void
  onChannel: (id: Id) => void
}

export function MobileConsoleBar<Id extends string>({
  name,
  channels,
  channel,
  page,
  badges,
  onStage,
  onChannel,
}: MobileConsoleBarP<Id>) {
  return (
    <nav className="mcb" aria-label="Member settings" style={{ '--mcb-n': channels.length + 1 } as never}>
      <button
        type="button"
        className={`mcb-tab${page === 'stage' ? ' is-on' : ''}`}
        aria-current={page === 'stage' ? 'page' : undefined}
        onClick={onStage}
      >
        <UserRound size={20} aria-hidden="true" />
        <span>{name}</span>
      </button>
      {channels.map((entry) => {
        const on = page === 'channel' && entry.id === channel
        const badge = badges[entry.id]
        return (
          <button
            type="button"
            key={entry.id}
            className={`mcb-tab${on ? ' is-on' : ''}`}
            aria-current={on ? 'page' : undefined}
            onClick={() => onChannel(entry.id)}
          >
            <span className="mcb-icon" aria-hidden="true">{entry.icon}</span>
            <span>
              {entry.label}
              {typeof badge === 'number' && badge > 0 ? <i>{badge}</i> : null}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
