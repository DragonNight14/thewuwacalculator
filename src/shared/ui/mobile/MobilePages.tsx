/*
  Author: Runor Ewhro
  description: controls one active mobile page while keeping every child
               mounted so page-local state survives navigation.
*/

import { useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'

export interface MobilePage {
  id: string
  label: string
  icon?: ReactNode
  badge?: ReactNode
  node: ReactNode
}

interface MobilePagesP {
  pages: MobilePage[]
  /** when omitted, the component tracks selection and initializes to the first page. */
  page?: string
  onPage?: (id: string) => void
  head?: ReactNode
  foot?: ReactNode
  className?: string
  onClick?: (event: MouseEvent<HTMLDivElement>) => void
}

export function MobilePages({ pages, page, onPage, head, foot, className, onClick }: MobilePagesP) {
  const [own, setOwn] = useState(pages[0]?.id ?? '')
  const current = pages.some((entry) => entry.id === (page ?? own)) ? (page ?? own) : pages[0]?.id
  const go = (id: string) => {
    if (page === undefined) setOwn(id)
    onPage?.(id)
  }

  return (
    <div className={['amdl mpg-native mpgs', className].filter(Boolean).join(' ')} onClick={onClick}>
      {head ? <div className="mpgs-head">{head}</div> : null}
      <div className="mpgs-pages">
        {pages.map((entry) => (
          <section
            key={entry.id}
            className="mpgs-page"
            hidden={entry.id !== current}
            aria-label={entry.label}
          >
            {entry.node}
          </section>
        ))}
      </div>
      {foot ? <div className="mpgs-foot">{foot}</div> : null}
      {pages.length > 1 ? (
        <nav className="mpgs-bar" aria-label="Pages" style={{ '--mpgs-n': pages.length } as never}>
          {pages.map((entry) => (
            <button
              type="button"
              key={entry.id}
              className={`mpgs-tab${entry.id === current ? ' is-on' : ''}`}
              aria-current={entry.id === current ? 'page' : undefined}
              onClick={() => go(entry.id)}
            >
              {entry.icon ? <span className="mpgs-icon" aria-hidden="true">{entry.icon}</span> : null}
              <span className="mpgs-label">
                {entry.label}
                {entry.badge !== undefined && entry.badge !== null && entry.badge !== 0 ? <i>{entry.badge}</i> : null}
              </span>
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  )
}
