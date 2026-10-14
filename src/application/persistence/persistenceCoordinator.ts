/*
  Author: Runor Ewhro
  description: coalesces dirty persistence domains and notifies flush owners
               when newly dirty state becomes available.
*/

import type { PersistKey } from './storage'

export class PersistenceCoordinator {
  private readonly pending = new Set<PersistKey>()
  private readonly listeners = new Set<() => void>()

  mark(keys: PersistKey[]): void {
    let changed = false
    for (const key of keys) {
      if (this.pending.has(key)) continue
      this.pending.add(key)
      changed = true
    }
    if (changed) for (const listener of this.listeners) listener()
  }

  consume(): PersistKey[] {
    const keys = [...this.pending]
    this.pending.clear()
    return keys
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  clear(): void { this.pending.clear() }
}

export const persistenceCoordinator = new PersistenceCoordinator()
