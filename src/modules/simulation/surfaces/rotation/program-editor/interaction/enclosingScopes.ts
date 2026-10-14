/*
  Author: Runor Ewhro
  description: derives the ordered execution scopes intersecting a viewport
               and the offset of the innermost scope from element bounds.
*/

interface StickyScope {
  el: HTMLElement
  kind: 'section' | 'loop' | 'repeat' | 'uptime' | 'setup' | 'run'
  /** react identity that gives a replacement scope its own entrance animation. */
  key: string
  label: string
  icon: string
  accent: string
  /** the loop this scope is, where it is one, so its passes stay selectable */
  loopId: string
  /** how many passes that loop takes; 0 for every other kind of scope */
  runs: number
  /** the run count a block repeats for, or the length of a resonator's run */
  note: string
  /** whatever the real header says about itself right now */
  meta: string
  total: string
}

export interface StickyState {
  scopes: StickyScope[]
  /** clamped collision offset for the innermost active scope. */
  shift: number
}

const EMPTY: StickyState = { scopes: [], shift: 0 }

function text(root: HTMLElement, selector: string): string {
  return root.querySelector(selector)?.textContent?.trim() ?? ''
}

function readScope(el: HTMLElement): StickyScope | null {
  if (el.classList.contains('rte-sec')) {
    const label = text(el, '.rte-band__title')
    return label
      ? {
        el,
        kind: 'section',
        loopId: '',
        runs: 0,
        key: `section:${label}`,
        label,
        icon: '',
        accent: '',
        note: '',
        meta: text(el, '.rte-band__meta'),
        total: text(el, '.rte-band__total'),
      }
      : null
  }

  // a run has no header of its own: its first step is the header, so the entry
  // restates that step and the resonator for that interval
  if (el.classList.contains('rte-run')) {
    const head = el.querySelector<HTMLElement>(':scope > .rte-row')
    const label = head ? text(head, '.rte-step__name') : ''
    if (!head || !label) {
      return null
    }

    const note = text(head, '.rte-step__runs')
    return {
      el,
      kind: 'run',
      loopId: '',
      runs: 0,
      key: `run:${label}:${note}`,
      label,
      // use the head row color for the external stack.
      accent: getComputedStyle(head).getPropertyValue('--rte-res').trim(),
      icon: head.querySelector<HTMLImageElement>('.rte-step__art')?.src ?? '',
      note: note ? `${note} steps` : '',
      meta: head.querySelector<HTMLElement>('.rte-step__owner')?.title?.split(' . ')[0] ?? '',
      // no total: the head row's damage is its own, not the run's sum, and in
      // the total's slot it would read as one
      total: '',
    }
  }

  const label = text(el, '.rte-block__name')
  if (!label) {
    return null
  }

  const kind = (['loop', 'repeat', 'uptime', 'setup'] as const).find((name) =>
    el.classList.contains(`rte-block--${name}`),
  ) ?? 'repeat'

  // an uptime block states a ratio where the others state a run count
  const note = text(el, ':scope > .rte-block__head .rte-block__x')
    || text(el, ':scope > .rte-block__head .rte-block__ratio')

  return {
    el,
    kind,
    key: `${kind}:${label}:${note}`,
    label,
    icon: '',
    // use the loop color for the external stack.
    accent: getComputedStyle(el).getPropertyValue('--rte-blk').trim(),
    loopId: el.dataset.loopId ?? '',
    runs: Number(el.dataset.runs ?? 0) || 0,
    note,
    meta: text(el, ':scope > .rte-block__head .rte-block__note'),
    total: text(el, ':scope > .rte-block__head .rte-block__total'),
  }
}

/**
 * a scope is enclosing when its own header has gone behind the stack and its
 * extent still reaches past it. scopes nest, so document order is already
 * outermost first and no sorting is needed.
 */
export function readStickyScopes(scroller: HTMLElement, rowHeight: number): StickyState {
  const top = scroller.getBoundingClientRect().top
  const found: StickyScope[] = []

  for (const node of scroller.querySelectorAll<HTMLElement>('.rte-sec, .rte-block, .rte-run')) {
    /*
      compare each header with the bottom of the current stack because the
      stack covers rows below the scrollport top. using the scrollport top
      delays entries, especially short nested runs.
    */
    const line = top + found.length * rowHeight
    const box = node.getBoundingClientRect()
    if (box.top >= line || box.bottom <= line) {
      continue
    }

    const header = node.querySelector<HTMLElement>(
      ':scope > .rte-band, :scope > .rte-block__head, :scope > .rte-row',
    )
    // a scope whose own header is still clear of the stack does not need restating
    if (header && header.getBoundingClientRect().bottom > line) {
      continue
    }

    const scope = readScope(node)
    if (scope) {
      found.push(scope)
    }
  }

  if (found.length === 0) {
    return EMPTY
  }

  /*
    as the innermost scope ends, its own entry slides up out of the stack. it
    travels at most its own height: past that it is behind the entry above and
    has nothing left to show, and the entries above must not move at all.
  */
  const innermost = found[found.length - 1].el.getBoundingClientRect()
  const stackHeight = found.length * rowHeight
  const room = innermost.bottom - top - stackHeight
  const shift = Math.max(-rowHeight, Math.min(0, room))

  return { scopes: found, shift }
}

export function sameStack(left: StickyState, right: StickyState): boolean {
  return (
    left.shift === right.shift &&
    left.scopes.length === right.scopes.length &&
    left.scopes.every((scope, index) => {
      const other = right.scopes[index]
      return (
        other != null &&
        scope.el === other.el &&
        scope.accent === other.accent &&
        scope.meta === other.meta &&
        scope.total === other.total
      )
    })
  )
}

/** put a scope's own header back under whatever stays stacked above it */
export function scrollToScope(scroller: HTMLElement, scope: StickyScope, above: number): void {
  const offset = scope.el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  scroller.scrollTo({ top: scroller.scrollTop + offset - above, behavior: 'smooth' })
}
