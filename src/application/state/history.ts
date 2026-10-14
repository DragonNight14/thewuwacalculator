/*
  Author: Runor Ewhro
  description: provides small immutable helpers for app-history snapshots,
               stack trimming, and user-facing history labels derived from
               changed runtime or persisted domains.
*/

import type { HistoryMax, PersistedState } from '@/domain/entities/appState'
import type { ResRuntime, TeamMemRtVie } from '@/domain/entities/runtime'
import type { PersistKey } from '@/application/persistence/storage'
import { decompressFromUTF16 } from 'lz-string'

export const RUNTIME_APP_HISTORY_ENABLED = true

export interface PersistChange {
  path: (string | number)[]
  before: unknown
  after: unknown
  beforeExists: boolean
  afterExists: boolean
}

export interface PrssHistEnt {
  changes: PersistChange[]
  packed?: string
  domains: PersistKey[]
  label: string
}

export interface PrssHistStt {
  past: PrssHistEnt[]
  future: PrssHistEnt[]
  isRestoring: boolean
}

export function mkMptyHistSt(): PrssHistStt {
  return {
    past: [],
    future: [],
    isRestoring: false,
  }
}

const DOMAIN_ROOTS: Record<PersistKey, readonly string[]> = {
  'ui.appearance': ['ui'],
  'ui.layout': ['ui'],
  'ui.showcaseCards': ['ui', 'preferences', 'showcaseCards'],
  'ui.savedRotationPreferences': ['ui', 'savedRotationPreferences'],
  'combat.workspace': ['combat'],
  'simulation.optimizerSettings': ['simulation'],
  'simulation.suggestions': ['simulation'],
  'library.echoes': ['library', 'echoes'],
  'library.builds': ['library', 'builds'],
  'library.rotations': ['library', 'rotations'],
  'library.scenarios': ['library', 'scenarios'],
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function child(value: unknown, key: string | number): { exists: boolean; value: unknown; descriptor?: PropertyDescriptor } {
  if (!isObject(value)) return { exists: false, value: undefined }
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor ? { exists: true, value: 'value' in descriptor ? descriptor.value : undefined, descriptor } : { exists: false, value: undefined }
}

function atPath(value: unknown, path: readonly string[]): unknown {
  for (const key of path) value = child(value, key).value
  return value
}

/** the action's declared domains identify affected state; reference changes tell
 * persistence which of those domains actually changed in this transaction. */
export function changedPersistDomains(before: PersistedState, after: PersistedState, domains: PersistKey[]): PersistKey[] {
  return domains.filter((domain) => !Object.is(
    atPath(before, DOMAIN_ROOTS[domain]),
    atPath(after, DOMAIN_ROOTS[domain]),
  ))
}

function addChanges(before: unknown, after: unknown, path: (string | number)[], output: PersistChange[], beforeExists = true, afterExists = true): void {
  if (beforeExists && afterExists && Object.is(before, after)) return
  if (beforeExists && afterExists && isObject(before) && isObject(after)
    && Array.isArray(before) === Array.isArray(after)) {
    if (Array.isArray(before) && Array.isArray(after) && before.length === after.length
      && before.every((item) => isObject(item) && typeof item.id === 'string')
      && after.every((item) => isObject(item) && typeof item.id === 'string')
      && before.some((item, index) => item.id !== after[index].id)) {
      output.push({ path, before, after, beforeExists, afterExists })
      return
    }
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    // array length changes are represented by the array itself so restoration
    // cannot leave holes or an incorrect length after a remove/reorder.
    if (!Array.isArray(before) || before.length === after.length) {
      for (const key of keys) {
        const oldChild = child(before, key)
        const newChild = child(after, key)
        if (oldChild.descriptor?.get && oldChild.descriptor.get === newChild.descriptor?.get) continue
        addChanges(oldChild.descriptor?.get ? oldChild.descriptor.get.call(before) : oldChild.value,
          newChild.descriptor?.get ? newChild.descriptor.get.call(after) : newChild.value,
          [...path, Array.isArray(before) ? Number(key) : key], output, oldChild.exists, newChild.exists)
      }
      return
    }
  }
  output.push({ path, before, after, beforeExists, afterExists })
}

/** walk only changed immutable branches; unchanged lazy scenario getters stay cold. */
export function makeHistoryEntry(before: PersistedState, after: PersistedState, domains: PersistKey[], label: string): PrssHistEnt | null {
  const changes: PersistChange[] = []
  const roots = new Set(domains.map((domain) => DOMAIN_ROOTS[domain].join('\u0000')))
  for (const root of roots) {
    const path = root.split('\u0000')
    addChanges(atPath(before, path), atPath(after, path), path, changes)
  }
  return changes.length ? { changes, domains: [...new Set(domains)], label } : null
}

function shouldCompact(entry: PrssHistEnt): boolean {
  return entry.changes.length > 100 || entry.changes.some((change) =>
    (Array.isArray(change.before) && change.before.length > 32)
    || (Array.isArray(change.after) && change.after.length > 32))
}

/** manages queued compression work and the active worker. */
export class HistoryCompactor {
  private readonly queue: PrssHistEnt[] = []
  private compacting = false

  retain(history: Pick<PrssHistStt, 'past' | 'future'>): void {
    if (this.queue.length === 0) return
    const retained = new Set([...history.past, ...history.future])
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (!retained.has(this.queue[index])) this.queue.splice(index, 1)
    }
  }

  queueEntry(entry: PrssHistEnt): void {
    if (typeof Worker === 'undefined' || !shouldCompact(entry)) return
    this.queue.push(entry)
    if (this.compacting) return
    const drain = () => {
      const next = this.queue.shift()
      if (!next) { this.compacting = false; return }
      const changes = next.changes
      let worker: Worker
      try {
        worker = new Worker(new URL('./historyCompression.worker.ts', import.meta.url), { type: 'module' })
      } catch { drain(); return }
      worker.onmessage = (event: MessageEvent<{ packed: string | null }>) => {
        if (event.data.packed && next.changes === changes) {
          next.packed = event.data.packed
          next.changes = []
        }
        worker.terminate()
        drain()
      }
      worker.onerror = () => { worker.terminate(); drain() }
      try { worker.postMessage(changes) }
      catch { worker.terminate(); drain() }
    }
    this.compacting = true
    if (typeof requestIdleCallback === 'function') requestIdleCallback(drain, { timeout: 2_000 })
    else setTimeout(drain, 0)
  }
}

const historyCompactor = new HistoryCompactor()
export function retainQueuedHistoryCompactions(history: Pick<PrssHistStt, 'past' | 'future'>): void {
  historyCompactor.retain(history)
}
export function queueHistoryCompaction(entry: PrssHistEnt): void {
  historyCompactor.queueEntry(entry)
}

function cloneBranch(value: unknown): Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return value.slice()
  return Object.defineProperties({}, Object.getOwnPropertyDescriptors(value ?? {}))
}

function applyOne(root: PersistedState, change: PersistChange, forward: boolean): PersistedState {
  const { path } = change
  const applyAt = (current: unknown, depth: number): unknown => {
    const key = path[depth]
    const copy = cloneBranch(current)
    if (depth === path.length - 1) {
      const exists = forward ? change.afterExists : change.beforeExists
      if (exists) Object.defineProperty(copy, key, { value: forward ? change.after : change.before, enumerable: true, writable: true, configurable: true })
      else delete (copy as Record<string | number, unknown>)[key]
    } else {
      Object.defineProperty(copy, key, { value: applyAt(child(current, key).value, depth + 1), enumerable: true, writable: true, configurable: true })
    }
    return copy
  }
  return applyAt(root, 0) as PersistedState
}

export function applyHistoryEntry(state: PersistedState, entry: PrssHistEnt, forward: boolean): PersistedState {
  let next = state
  const unpacked = entry.packed
    ? JSON.parse(decompressFromUTF16(entry.packed) ?? '[]') as PersistChange[]
    : entry.changes
  const changes = forward ? unpacked : unpacked.slice().reverse()
  for (const change of changes) next = applyOne(next, change, forward)
  return next
}

export function trimHistEnts<TEntry>(entries: TEntry[], max: HistoryMax, keep: 'recent' | 'earliest'): TEntry[] {
  if (entries.length <= max) {
    return entries
  }

  return keep === 'recent'
    ? entries.slice(-max)
    : entries.slice(0, max)
}

function areVlsQl(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!isObject(left) || !isObject(right) || Array.isArray(left) !== Array.isArray(right)) return false
  if (Array.isArray(left) && left.length !== (right as unknown as unknown[]).length) return false
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => Object.hasOwn(right, key) && areVlsQl(left[key], right[key]))
}

export function resFllbHistL(dirtyDomains: PersistKey[]): string {
  // prefer the most meaningful domain bucket for history labels.
  const domainSet = new Set(dirtyDomains)

  if (domainSet.has('library.echoes')) {
    return 'Updated Inventory Echoes'
  }

  if (domainSet.has('library.builds')) {
    return 'Updated Inventory Builds'
  }

  if (domainSet.has('library.rotations')) {
    return 'Updated Inventory Rotations'
  }

  if (domainSet.has('library.scenarios')) {
    return 'Updated Saved Scenarios'
  }

  if (domainSet.has('simulation.optimizerSettings')) {
    return 'Updated Optimizer Settings'
  }

  if (domainSet.has('combat.workspace')) {
    return 'Updated Combat Scenario'
  }

  if (domainSet.has('simulation.suggestions')) {
    return 'Updated Suggestions'
  }

  if (domainSet.has('ui.savedRotationPreferences')) {
    return 'Updated Saved Rotation Preferences'
  }

  if (domainSet.has('ui.appearance')) {
    return 'Updated Appearance'
  }

  if (domainSet.has('ui.layout')) {
    return 'Updated Layout'
  }

  return 'Updated State'
}

export function mkRtUpdHistL(
  previous: ResRuntime,
  next: ResRuntime,
): string {
  // check visible setup areas first for specific history labels.
  if (!areVlsQl(previous.build.echoes, next.build.echoes)) {
    return 'Updated Equipped Echoes'
  }

  if (!areVlsQl(previous.build.weapon, next.build.weapon)) {
    return 'Updated Weapon'
  }

  if (!areVlsQl(previous.build.team, next.build.team)
    || !areVlsQl(previous.teamRuntimes, next.teamRuntimes)) {
    return 'Updated Team Setup'
  }

  if (!areVlsQl(previous.base, next.base)) {
    return 'Updated Resonator Progression'
  }

  if (!areVlsQl(previous.rotation, next.rotation)) {
    return 'Updated Rotation'
  }

  if (!areVlsQl(previous.state, next.state)) {
    return 'Updated Combat State'
  }

  return 'Updated Resonator Setup'
}

export function mkTeamMemRtU(
  previous: TeamMemRtVie,
  next: TeamMemRtVie,
): string {
  // teammate labels mirror the primary runtime labels, but keep the wording
  // explicit so undo/redo stays readable when team edits are mixed in.
  if (!areVlsQl(previous.build.echoes, next.build.echoes)) {
    return 'Updated Teammate Echoes'
  }

  if (!areVlsQl(previous.build.weapon, next.build.weapon)) {
    return 'Updated Teammate Weapon'
  }

  if (!areVlsQl(previous.base, next.base)) {
    return 'Updated Teammate Progression'
  }

  if (!areVlsQl(previous.state, next.state)) {
    return 'Updated Teammate State'
  }

  return 'Updated Teammate Setup'
}
