/*
  Author: Runor Ewhro
  description: stores non-persisted rotation drafts across route mounts without changing saved simulation state.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { createStore, useStore } from 'zustand'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type {
  EditorSection,
  LoopRunSelections,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import { withRunMetadata, type RunResult } from '@/modules/simulation/surfaces/rotation/program-editor/simulation/runProgram.ts'
import type { RotationEditHistory } from '@/modules/simulation/surfaces/rotation/program-editor/interaction/history.ts'

export interface RotationEditorSession {
  result: RunResult | null
  sections: EditorSection[]
  runsByLoopId: LoopRunSelections
  lastRanAt: number | null
  editHistory: RotationEditHistory
  /** the program against which authored execution changes are considered dirty. */
  baselineItems: RotationNode[]
  runBaselineKey: string

  runBaselineSigs: Map<string, string>
  simulationKey: string
  /** prepared simulation workspace that produced `result` and evaluated rows. */
  runInputIdentity: object | null
}

type SessionUpdate = (current: RotationEditorSession) => RotationEditorSession

interface RotationEditorSessionState {
  byOwnerId: Record<string, RotationEditorSession>
  generationByOwnerId: Record<string, number>
}

const rotationEditorSessionStore = createStore<RotationEditorSessionState>(() => ({
  byOwnerId: {},
  generationByOwnerId: {},
}))
/** tracks mounted editor leases and releases heavy traces after route transitions. */
export class RotationEditorRetentionController {
  private readonly mountedOwners = new Map<string, number>()
  private readonly dormantTimers = new Map<string, ReturnType<typeof setTimeout>>()

  clear(ownerId: string): void {
    const pending = this.dormantTimers.get(ownerId)
    if (pending) clearTimeout(pending)
    this.dormantTimers.delete(ownerId)
  }

  clearAll(): void {
    for (const timer of this.dormantTimers.values()) clearTimeout(timer)
    this.dormantTimers.clear()
  }

  hold(ownerId: string): () => void {
    this.clear(ownerId)
    this.mountedOwners.set(ownerId, (this.mountedOwners.get(ownerId) ?? 0) + 1)
    return () => {
      const remaining = (this.mountedOwners.get(ownerId) ?? 1) - 1
      if (remaining > 0) {
        this.mountedOwners.set(ownerId, remaining)
        return
      }
      this.mountedOwners.delete(ownerId)
      // wait past strict mode effect replay and route transitions before dropping
      // the large execution trace. the authored draft and undo stack survive.
      this.dormantTimers.set(ownerId, setTimeout(() => {
        this.dormantTimers.delete(ownerId)
        if (this.mountedOwners.has(ownerId)) return
        updateRotationEditorSession(ownerId, (current) => current.result
          ? { ...current, result: null, runInputIdentity: null }
          : current)
      }, 2_000))
    }
  }
}

const retention = new RotationEditorRetentionController()

export function getRotationEditorSession(ownerId: string): RotationEditorSession | null {
  return rotationEditorSessionStore.getState().byOwnerId[ownerId] ?? null
}

export function getRotationEditorSessionGeneration(ownerId: string): number {
  return rotationEditorSessionStore.getState().generationByOwnerId[ownerId] ?? 0
}

/** build once for an owner. the factory is deliberately not read again. */
export function ensureRotationEditorSession(
  ownerId: string,
  create: () => RotationEditorSession,
): RotationEditorSession {
  const current = getRotationEditorSession(ownerId)
  if (current) return current

  const created = create()
  rotationEditorSessionStore.setState((state) => ({
    byOwnerId: {
      ...state.byOwnerId,
      [ownerId]: created,
    },
  }))
  return created
}

/**
 * refresh only the evaluated side of a standing draft when simulation inputs
 * change. the caller decides how authored sections/history are preserved; the
 * store makes the refresh once per immutable workspace identity and retains
 * the last authored run's date and timing for the standing readout.
 */
export function reconcileRotationEditorSession(
  ownerId: string,
  runInputIdentity: object | null,
  reconcile: SessionUpdate,
): RotationEditorSession | null {
  const current = getRotationEditorSession(ownerId)
  if (!current || current.runInputIdentity === runInputIdentity) return current

  const evaluated = reconcile(current)
  const refreshed = current.result && evaluated.result
    ? {
        ...evaluated,
        result: withRunMetadata(evaluated.result, {
          ranAt: current.result.ranAt,
          timing: current.result.timing,
        }),
      }
    : evaluated
  const next = refreshed.runInputIdentity === runInputIdentity
    ? refreshed
    : { ...refreshed, runInputIdentity }
  rotationEditorSessionStore.setState((state) => ({
    byOwnerId: {
      ...state.byOwnerId,
      [ownerId]: next,
    },
  }))
  return next
}

export function updateRotationEditorSession(
  ownerId: string,
  update: SessionUpdate,
): void {
  rotationEditorSessionStore.setState((state) => {
    const current = state.byOwnerId[ownerId]
    if (!current) return state
    const next = update(current)
    if (next === current) return state
    return {
      byOwnerId: {
        ...state.byOwnerId,
        [ownerId]: next,
      },
    }
  })
}

/**
 * explicit document replacement is the only ordinary workflow that discards a
 * draft. the generation changes even when that owner has not mounted yet, so a
 * load and a same-owner replacement both seed from the incoming scenario.
 */
export function clearRotationEditorSession(ownerId: string): void {
  retention.clear(ownerId)
  rotationEditorSessionStore.setState((state) => {
    const next = { ...state.byOwnerId }
    delete next[ownerId]
    return {
      byOwnerId: next,
      generationByOwnerId: {
        ...state.generationByOwnerId,
        [ownerId]: (state.generationByOwnerId[ownerId] ?? 0) + 1,
      },
    }
  })
}

export function clearAllRotationEditorSessions(): void {
  retention.clearAll()
  rotationEditorSessionStore.setState({ byOwnerId: {}, generationByOwnerId: {} })
}

export function holdRotationEditorOwner(ownerId: string): () => void {
  return retention.hold(ownerId)
}

export function useRotationEditorSession(
  ownerId: string,
  runInputIdentity: object | null,
  create: () => RotationEditorSession,
  reconcile: SessionUpdate,
) {
  const [initial, setInitial] = useState<{ ownerId: string; session: RotationEditorSession } | null>(() => ({
    ownerId,
    session: getRotationEditorSession(ownerId) ?? create(),
  }))
  const session = useStore(
    rotationEditorSessionStore,
    (state) => state.byOwnerId[ownerId],
  )
  const generation = useStore(
    rotationEditorSessionStore,
    (state) => state.generationByOwnerId[ownerId] ?? 0,
  )
  const createRef = useRef(create)
  useEffect(() => {
    createRef.current = create
  }, [create])

  useEffect(() => {
    ensureRotationEditorSession(ownerId, () => (
      initial?.ownerId === ownerId && generation === 0
        ? initial.session
        : createRef.current()
    ))
    reconcileRotationEditorSession(ownerId, runInputIdentity, reconcile)
    // the store now manages the session. do not pin its initial full run through
    // every later edit and execution for the lifetime of this page mount.
    if (!initial) return
    let canceled = false
    queueMicrotask(() => {
      if (!canceled) setInitial((current) => current === initial ? null : current)
    })
    return () => { canceled = true }
  }, [generation, initial, ownerId, reconcile, runInputIdentity])
  useEffect(() => holdRotationEditorOwner(ownerId), [ownerId])

  const updateSession = useCallback((update: SessionUpdate) => {
    updateRotationEditorSession(ownerId, update)
  }, [ownerId])

  return {
    ...(session ?? (initial?.ownerId === ownerId
      ? initial.session
      : getRotationEditorSession(ownerId) ?? create())),
    updateSession,
  }
}
