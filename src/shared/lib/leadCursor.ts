/*
  Author: Runor Ewhro
  description: positions an animated cursor beside selected or hovered rows.
               movement changes its size and blur, and offscreen rows clamp its
               position to the panel edge. saved rotations and damage formulas
               configure their row selectors, css properties, and colors.
*/

export interface LeadCursorOptions {
  /** scroll container for the cursor rows */
  body: HTMLElement
  /** the overlay the cursor is positioned inside, sized to the body */
  rail: HTMLElement
  cursor: HTMLElement
  /** selector for cursor rows within the body */
  rowSelector: string
  /** selected row used when the pointer is outside the body */
  findSelected?: () => HTMLElement | null
  /** the custom property stem, so `--rsl-cursor` writes `--rsl-cursor-y` */
  prefix: string
  /** row property used for the cursor color */
  inkVar?: string
  /** cursor height when it is not expanded to a row */
  restHeight?: number
  /** minimum distance from the rail edges */
  edge?: number
  /** pointer dwell time before the cursor expands to row height */
  dockMs?: number
}

export interface LeadCursor {
  attach: () => () => void
  select: (punch: boolean) => void
}

export function makeLeadCursor({
  body,
  rail,
  cursor,
  rowSelector,
  findSelected,
  prefix,
  inkVar,
  restHeight = 21,
  edge = 13,
  dockMs = 110,
}: LeadCursorOptions): LeadCursor {
  let at: number | null = null
  let want: number | null = null
  let wantHeight = restHeight
  let held: HTMLElement | null = null
  let docked = false
  let pointerAt: number | null = null
  let punch = 0
  let frame = 0
  let dockTimer: number | null = null

  const run = () => {
    if (!frame) frame = requestAnimationFrame(step)
  }

  function step() {
    frame = 0
    if (want == null) return

    const from = at
    at = from == null ? want : from + (want - from) * 0.24
    const moved = from == null ? 0 : at - from

    const speed = Math.min(1, Math.abs(moved) / 15)
    cursor.style.setProperty(`${prefix}-y`, `${at.toFixed(2)}px`)
    cursor.style.setProperty(`${prefix}-sy`, (1 + speed * 0.62 - punch * 0.34).toFixed(3))
    cursor.style.setProperty(`${prefix}-sx`, (1 - speed * 0.3 + punch * 0.85).toFixed(3))
    cursor.style.setProperty(`${prefix}-bl`, (speed * 1.15).toFixed(2))
    cursor.style.setProperty(`${prefix}-h`, `${wantHeight}px`)
    cursor.style.setProperty(`${prefix}-w`, wantHeight > restHeight + 1 ? '4px' : '3px')

    punch = punch < 0.02 ? 0 : punch * 0.82
    if (Math.abs(want - at) > 0.25 || speed > 0.004 || punch) run()
  }

  /* position the cursor at the row center with at most 22% pointer offset. */
  const aim = () => {
    const row = held ?? findSelected?.() ?? null
    if (!row) {
      rail.classList.remove('is-on')
      return
    }

    const railBox = rail.getBoundingClientRect()
    const rowBox = row.getBoundingClientRect()
    const middle = rowBox.top + rowBox.height / 2
    const lean = held && pointerAt != null
      ? Math.max(-rowBox.height / 2, Math.min(rowBox.height / 2, pointerAt - middle)) * 0.22
      : 0

    want = Math.max(
      edge,
      Math.min(railBox.height - edge, middle - railBox.top + lean),
    )
    wantHeight = held && docked ? Math.max(restHeight, rowBox.height - 7) : restHeight
    if (inkVar) {
      cursor.style.setProperty(inkVar, getComputedStyle(row).getPropertyValue(inkVar))
    }
    rail.classList.add('is-on')
    run()
  }

  const track = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    pointerAt = event.clientY

    body.querySelectorAll<HTMLElement>(rowSelector).forEach((row) => {
      const box = row.getBoundingClientRect()
      if (pointerAt! >= box.top - 3 && pointerAt! <= box.bottom + 3) held = row
    })

    docked = false
    if (dockTimer != null) window.clearTimeout(dockTimer)
    dockTimer = window.setTimeout(() => { docked = true; aim() }, dockMs)
    aim()
  }

  const release = () => {
    if (dockTimer != null) window.clearTimeout(dockTimer)
    dockTimer = null
    held = null
    docked = false
    pointerAt = null
    aim()
  }

  return {
    attach() {
      aim()
      body.addEventListener('pointermove', track)
      body.addEventListener('pointerleave', release)
      body.addEventListener('scroll', aim, { passive: true })
      const observer = new ResizeObserver(aim)
      observer.observe(body)

      return () => {
        body.removeEventListener('pointermove', track)
        body.removeEventListener('pointerleave', release)
        body.removeEventListener('scroll', aim)
        observer.disconnect()
        if (dockTimer != null) window.clearTimeout(dockTimer)
        if (frame) cancelAnimationFrame(frame)
        frame = 0
      }
    },
    select(hit: boolean) {
      if (hit) punch = 1
      aim()
    },
  }
}
