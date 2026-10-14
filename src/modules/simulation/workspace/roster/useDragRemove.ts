/*
  Author: Runor Ewhro
  description: handles drag-to-remove gestures for roster items. releasing past
               the snap threshold removes the item; moving back retains it.
               pointer movement updates overlay geometry without rerendering
               the column, and overlays render outside the clipping scroll box.
*/

import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

// release and reattachment distances for the dragged item.
const SNAP_PX = 58
const HOOK_PX = 30
// the item follows the pointer at 90% while attached to the list.
const DRAG_GIVE = 0.9
const START_PX = 7
const STRING_SPAN_PX = 76
const RING_MS = 520
const LEAVE_MS = 420

interface Pull {
  id: string
  item: HTMLElement
  pointerId: number
  startX: number
  startY: number
  lifted: boolean
  free: boolean
  settling: boolean
  cx: number
  cy: number
  top: number
  bottom: number
  pull: number
  frame: number
  timer: number
}

export interface DragState {
  id: string
  free: boolean
}

function reduced(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.classList.contains('reduce-animation')
}

export function useDragRemove({
  enabled,
  confirmRemoval,
  columnRef,
  scrollRef,
  listRef,
  dragLineRef,
  previewRef,
  onState,
  onRemove,
}: {
  enabled: boolean
  /** pending removal returns the item to its original position. */
  confirmRemoval: boolean
  columnRef: RefObject<HTMLElement | null>
  scrollRef: RefObject<HTMLElement | null>
  listRef: RefObject<HTMLElement | null>
  dragLineRef: RefObject<SVGSVGElement | null>
  previewRef: RefObject<HTMLElement | null>
  onState: (state: DragState | null) => void
  onRemove: (id: string) => void
}) {
  const pullRef = useRef<Pull | null>(null)
  const swallowUntil = useRef(0)
  const live = useRef({ confirmRemoval, onState, onRemove })
  useEffect(() => {
    live.current = { confirmRemoval, onState, onRemove }
  }, [confirmRemoval, onRemove, onState])

  const drawDragLine = useCallback((pull: Pull, x: number, slack: boolean) => {
    const path = dragLineRef.current?.firstElementChild
    if (!path) return
    const { cx, cy, top, bottom } = pull
    path.setAttribute(
      'd',
      `M${cx} ${top} Q${cx} ${cy - (cy - top) * 0.3} ${x} ${cy} Q${cx} ${cy + (bottom - cy) * 0.3} ${cx} ${bottom}`,
    )
    if (slack) path.setAttribute('data-slack', 'true')
    else path.removeAttribute('data-slack')
  }, [dragLineRef])

  const finish = useCallback(() => {
    const pull = pullRef.current
    if (!pull) return
    cancelAnimationFrame(pull.frame)
    window.clearTimeout(pull.timer)
    pull.item.removeAttribute('data-pulled')
    pull.item.removeAttribute('data-leaving')
    const list = listRef.current
    list?.removeAttribute('data-pull')
    dragLineRef.current?.removeAttribute('data-on')
    const lift = previewRef.current
    if (lift) {
      lift.removeAttribute('data-on')
      lift.removeAttribute('data-free')
      lift.removeAttribute('data-home')
      lift.getAnimations().forEach((animation) => animation.cancel())
    }
    document.body.style.removeProperty('user-select')
    pullRef.current = null
    live.current.onState(null)
  }, [previewRef, dragLineRef, listRef])

  // animate the drag line to its resting position and optionally move the preview.
  const ring = useCallback((pull: Pull, from: number, carry: boolean, done?: () => void) => {
    cancelAnimationFrame(pull.frame)
    const lift = previewRef.current
    if (reduced()) {
      drawDragLine(pull, pull.cx, true)
      if (carry && lift) lift.style.left = `${pull.cx}px`
      done?.()
      return
    }
    const started = performance.now()
    const step = (now: number) => {
      const t = now - started
      const x = from * Math.exp(-t / 95) * Math.cos(t / 24)
      drawDragLine(pull, pull.cx + x, !carry)
      if (carry && lift) lift.style.left = `${pull.cx + x}px`
      if (t < RING_MS) {
        pull.frame = requestAnimationFrame(step)
        return
      }
      drawDragLine(pull, pull.cx, true)
      done?.()
    }
    pull.frame = requestAnimationFrame(step)
  }, [drawDragLine, previewRef])

  const lift = useCallback((pull: Pull): boolean => {
    const column = columnRef.current
    const box = scrollRef.current
    const list = listRef.current
    const ghost = previewRef.current
    const pic = pull.item.querySelector<HTMLElement>('.build-roster-item-image')
    const img = pic?.querySelector('img')
    const ghostImg = ghost?.querySelector('img')
    if (!column || !box || !list || !ghost || !pic || !img || !ghostImg) return false

    const c = column.getBoundingClientRect()
    const p = pic.getBoundingClientRect()
    const view = box.getBoundingClientRect()
    const line = list.getBoundingClientRect()
    pull.cx = p.left + p.width / 2 - c.left
    pull.cy = p.top + p.height / 2 - c.top
    pull.top = Math.max(view.top - c.top + 10, pull.cy - STRING_SPAN_PX)
    pull.bottom = Math.min(view.bottom - c.top - 10, pull.cy + STRING_SPAN_PX)
    pull.lifted = true

    const ink = pull.item.style.getPropertyValue('--row-ink')
    ghostImg.src = img.currentSrc || img.src
    ghost.style.setProperty('--row-ink', ink)
    ghost.style.left = `${pull.cx}px`
    ghost.style.top = `${pull.cy}px`
    ghost.style.width = `${p.width}px`
    ghost.style.height = `${p.width}px`
    ghost.setAttribute('data-on', 'true')
    pull.item.setAttribute('data-pulled', 'true')

    // hide the list segment covered by the drag line.
    list.style.setProperty('--pull-from', `${pull.top - (line.top - c.top)}px`)
    list.style.setProperty('--pull-to', `${pull.bottom - (line.top - c.top)}px`)
    list.setAttribute('data-pull', 'true')
    dragLineRef.current?.style.setProperty('--row-ink', ink)
    dragLineRef.current?.setAttribute('data-on', 'true')
    drawDragLine(pull, pull.cx, false)

    try {
      pull.item.setPointerCapture(pull.pointerId)
    } catch {
      // window listeners finish the pull after the pointer leaves the item.
    }
    document.body.style.userSelect = 'none'
    live.current.onState({ id: pull.id, free: false })
    return true
  }, [columnRef, drawDragLine, previewRef, scrollRef, dragLineRef, listRef])

  const release = useCallback((cancel: boolean) => {
    const pull = pullRef.current
    if (!pull) return
    if (!pull.lifted) {
      pullRef.current = null
      return
    }
    if (pull.settling) return
    pull.settling = true
    swallowUntil.current = performance.now() + 80
    const ghost = previewRef.current

    if (!pull.free) {
      ring(pull, pull.pull, true, finish)
      return
    }

    const goHome = () => {
      if (ghost) {
        ghost.setAttribute('data-home', 'true')
        ghost.removeAttribute('data-free')
        ghost.style.left = `${pull.cx}px`
        ghost.style.top = `${pull.cy}px`
      }
      live.current.onState({ id: pull.id, free: false })
      pull.timer = window.setTimeout(finish, reduced() ? 0 : LEAVE_MS)
    }

    if (cancel) {
      goHome()
      return
    }
    if (live.current.confirmRemoval) {
      goHome()
      live.current.onRemove(pull.id)
      return
    }

    // remove the roster item after the portrait and list animations finish.
    ghost?.animate(
      [{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.55, translate: '-50% -10%' }],
      { duration: reduced() ? 0 : 280, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
    )
    pull.item.setAttribute('data-leaving', 'true')
    live.current.onState(null)
    pull.timer = window.setTimeout(() => {
      const { id } = pull
      finish()
      live.current.onRemove(id)
    }, reduced() ? 0 : LEAVE_MS)
  }, [finish, previewRef, ring])

  const onMove = useCallback((event: PointerEvent) => {
    const pull = pullRef.current
    if (!pull || pull.settling || event.pointerId !== pull.pointerId) return
    const dx = event.clientX - pull.startX
    const dy = event.clientY - pull.startY
    if (!pull.lifted) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
        pullRef.current = null
        return
      }
      if (Math.abs(dx) < START_PX) return
      if (!lift(pull)) {
        pullRef.current = null
        return
      }
    }
    event.preventDefault()
    const ghost = previewRef.current
    if (!ghost) return
    const wasFree = pull.free
    pull.free = wasFree ? Math.abs(dx) > HOOK_PX : Math.abs(dx) * DRAG_GIVE >= SNAP_PX

    if (pull.free) {
      ghost.style.left = `${pull.cx + dx}px`
      ghost.style.top = `${pull.cy + dy}px`
      if (!wasFree) {
        ghost.setAttribute('data-free', 'true')
        live.current.onState({ id: pull.id, free: true })
        ring(pull, SNAP_PX * (dx < 0 ? -0.5 : 0.5), false)
      }
      return
    }

    cancelAnimationFrame(pull.frame)
    if (wasFree) {
      ghost.removeAttribute('data-free')
      live.current.onState({ id: pull.id, free: false })
    }
    pull.pull = dx * DRAG_GIVE
    ghost.style.left = `${pull.cx + pull.pull}px`
    ghost.style.top = `${pull.cy}px`
    drawDragLine(pull, pull.cx + pull.pull, false)
  }, [drawDragLine, lift, previewRef, ring])

  useEffect(() => {
    if (!enabled) return undefined
    const onUp = () => release(false)
    const onCancel = () => release(true)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && pullRef.current?.lifted) release(true)
    }
    const box = scrollRef.current
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    box?.addEventListener('scroll', onCancel, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
      box?.removeEventListener('scroll', onCancel)
      finish()
    }
  }, [enabled, finish, onMove, release, scrollRef])

  const onPointerDown = useCallback((id: string, event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0 || pullRef.current) return
    pullRef.current = {
      id,
      item: event.currentTarget,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lifted: false,
      free: false,
      settling: false,
      cx: 0,
      cy: 0,
      top: 0,
      bottom: 0,
      pull: 0,
      frame: 0,
      timer: 0,
    }
  }, [enabled])

  // suppress the click emitted after a drag ends over the item.
  const swallowClick = useCallback(() => performance.now() < swallowUntil.current, [])

  return { onPointerDown, swallowClick }
}
