/*
  Author: Runor Ewhro
  description: shared portal target lookups for simulation overlays and
               dialogs that render into either the page body or main shell.
*/

// mount overlays outside the route transition container, which is a backdrop root.
export function mainPortal(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  return (document.querySelector('.app-shell') as HTMLElement | null)
    ?? (document.querySelector('.main-content') as HTMLElement | null)
    ?? document.body
}

// resolve the persistent chrome host for controls that must outlive routed content.
export function chromePortal(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  return (document.querySelector('.ax-chrome') as HTMLElement | null) ?? mainPortal()
}

// use the topmost open dialog as the portal boundary for nested floating controls.
export function dialogPortal(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  const overlays = Array.from(
    document.querySelectorAll<HTMLElement>('.app-modal-overlay.open:not(.closing)'),
  )

  return overlays.at(-1) ?? null
}

export function bodyPortal(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  return document.body
}
