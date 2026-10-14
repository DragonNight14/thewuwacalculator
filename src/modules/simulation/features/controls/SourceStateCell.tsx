/*
  Author: Runor Ewhro
  description: normalizes toggle, numeric, and select source states into one
               binary activation path without intercepting nested controls.
*/

import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { readRtPath } from '@/domain/gameData/runtimePath.ts'
import { getSrcSttNct, getSrcNumMax } from '@/engine/gameData/controlOptions.ts'
import { isStateVisible, sourceOptions } from '@/engine/services/sourceStateService.ts'
import {
  isSrcSttOn,
  setRtPath,
  setSourceState,
  type RtUpdHnd,
} from './lib/runtimeStateUtils.ts'

const OWN_CONTROL = 'button, input, select, textarea, a, [role="button"], [role="radio"], [role="switch"], [role="listbox"], .app-select, .team-state-target'

function isChecked(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === 'true'
  return typeof value === 'number' && value > 0
}

interface SourceStateCellProps {
  className: string
  state: SourceState
  runtime: ResRuntime
  actRt: ResRuntime
  onRtPdt: RtUpdHnd
  children: ReactNode
}

export function SourceStateCell({
  className,
  state,
  runtime,
  actRt,
  onRtPdt,
  children,
}: SourceStateCellProps) {
  const enabled = isStateVisible(runtime, runtime, state, actRt)
    && isSrcSttOn(runtime, runtime, state, actRt)
  const value = readRtPath(runtime, state.path) ?? getSrcSttNct(runtime, runtime, state, actRt)
  const min = state.min ?? 0
  const authoredMax = getSrcNumMax(runtime, runtime, state, actRt) ?? state.maxValue
  const max = Number(authoredMax)
  const numeric = state.kind === 'stack' || state.kind === 'number'
  const options = state.kind === 'select' ? sourceOptions(runtime, runtime, state, actRt) : []
  const firstOption = options[0]?.id
  const lastOption = options.at(-1)?.id
  const selectable = firstOption !== undefined && lastOption !== undefined && firstOption !== lastOption
  const actionable = enabled && (
    state.kind === 'toggle'
    || (numeric && Number.isFinite(max) && max > min)
    || selectable
  )
  const pressed = state.kind === 'toggle'
    ? isChecked(value)
    : numeric ? Number(value) >= max : selectable && String(value) === lastOption

  const activate = () => {
    if (!actionable) return
    if (state.kind === 'toggle') {
      setSourceState(onRtPdt, runtime, runtime, state, !pressed, actRt)
    } else if (numeric) {
      setRtPath(onRtPdt, state.path, pressed ? min : max)
    } else if (selectable) {
      setSourceState(onRtPdt, runtime, runtime, state, pressed ? firstOption : lastOption, actRt)
    }
  }

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return
    // closest() also returns the row itself because of its button role.
    const ownControl = target.closest(OWN_CONTROL)
    if (ownControl && ownControl !== event.currentTarget) return
    activate()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    activate()
  }

  return (
    <div
      className={className}
      role={actionable ? 'button' : undefined}
      tabIndex={actionable ? 0 : undefined}
      aria-label={actionable ? state.label : undefined}
      aria-pressed={actionable ? pressed : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )
}
