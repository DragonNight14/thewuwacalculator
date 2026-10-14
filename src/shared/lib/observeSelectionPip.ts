/*
  Author: Runor Ewhro
  description: measures a selection marker once per resize frame, completing
               all layout/style reads before applying changed coordinates.
*/
export function observeSelectionPip(wrap: HTMLElement, rows: HTMLElement, mark: HTMLElement, key: string | null): () => void {
  let frame: number | null = null
  const place = () => {
    frame = null
    const row = key ? wrap.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"]`) : null
    if (!row) { mark.classList.remove('is-on'); return }
    const wrapBox = wrap.getBoundingClientRect()
    const rowBox = row.getBoundingClientRect()
    const rowsBox = rows.getBoundingClientRect()
    const card = wrap.querySelector<HTMLElement>('.pgd-aside')
    const cardBox = card?.getBoundingClientRect()
    const ink = getComputedStyle(row).getPropertyValue('--pgd-ink')
    const channel = cardBox ? (rowsBox.right + cardBox.left) / 2 : rowsBox.right
    const properties: Record<string, string> = {
      '--pgd-pip-top': `${Math.round(rowBox.top + rowBox.height / 2 - wrapBox.top)}px`,
      '--pgd-pip-x': `${Math.round(channel - wrapBox.left)}px`,
      '--pgd-pip-e': ink,
    }
    for (const [name, value] of Object.entries(properties)) {
      if (mark.style.getPropertyValue(name) !== value) mark.style.setProperty(name, value)
    }
    mark.classList.add('is-on')
  }
  place()
  const watch = new ResizeObserver(() => {
    if (frame === null) frame = requestAnimationFrame(place)
  })
  watch.observe(rows)
  watch.observe(wrap)
  return () => {
    watch.disconnect()
    if (frame !== null) cancelAnimationFrame(frame)
  }
}
