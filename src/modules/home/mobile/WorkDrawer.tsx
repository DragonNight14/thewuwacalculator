/*
  Author: Runor Ewhro
  description: maps application routes and active-resonator state into the
               mobile home work-page drawer.
*/

import { useEffect, useState } from 'react'
import { AxLink } from '@/shared/navigation/useNavX'
import { SIMULATION_PAGES } from '@/application/navigation/appIndex'
import type { AppSnapshot } from '@/modules/home/model/useAppSnapshot'

export function WorkDrawer({ snapshot }: { snapshot: AppSnapshot }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <div className={`mh-scrim${open ? ' is-on' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <section className={`mh-work${open ? ' is-open' : ''}`} aria-label="Work">
        <button
          type="button"
          className="mh-work__head"
          aria-expanded={open}
          onClick={() => setOpen((at) => !at)}
        >
          <span className="mh-work__k">Work <span>{SIMULATION_PAGES.length} pages</span></span>
          {snapshot.active ? <span className="mh-work__who">{SIMULATION_PAGES[0].name} · {snapshot.active.name}</span> : null}
          <svg viewBox="0 0 14 14" aria-hidden="true"><path d="m3 9 4-4 4 4" /></svg>
        </button>

        <div className="mh-work__rows" inert={!open}>
          {SIMULATION_PAGES.map((page) => {
            const read = snapshot.reading[page.id]
            return (
              <AxLink className="mh-row" to={page.to} key={page.id}>
                <b>{page.name}<em>{page.scope}</em></b>
                {read ? <span>{read.value}</span> : null}
              </AxLink>
            )
          })}
        </div>
      </section>
    </>
  )
}
