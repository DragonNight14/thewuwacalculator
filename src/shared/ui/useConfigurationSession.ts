/*
  Author: Runor Ewhro
  description: keeps configuration edits in a local reducer draft until the
               temporary surface closes.
*/

import { useCallback, useEffect, useRef, useState } from 'react'

export type ConfigurationReducer<T> = (current: T) => T

export interface ConfigurationTransaction<T> {
  read: () => T
  update: (reducer: ConfigurationReducer<T>) => T
  /** full replacement; unlike update reducers, it does not merge later source changes. */
  replace: (next: T) => T
  finish: () => void
  reset: (source: T) => T
  isDirty: () => boolean
}

interface ConfigurationSessionOptions<T> {
  source: T
  active?: boolean
  clone?: (source: T) => T
  commit: (reducer: ConfigurationReducer<T>) => void
}

function identity<T>(value: T): T {
  return value
}

export function createConfigurationTransaction<T>(
  source: T,
  commit: (reducer: ConfigurationReducer<T>) => void,
  clone: (source: T) => T = structuredClone,
): ConfigurationTransaction<T> {
  let draft = clone(source)
  let reducer: ConfigurationReducer<T> = identity
  let dirty = false
  let finished = false

  const update = (nextReducer: ConfigurationReducer<T>) => {
    if (finished) return draft

    const next = nextReducer(draft)
    if (Object.is(draft, next)) return draft

    // replay composed edits against the latest committed source. a draft cloned
    // before unrelated updates may be stale.
    const previousReducer = reducer
    reducer = (current) => nextReducer(previousReducer(current))
    draft = next
    dirty = true
    return draft
  }

  return {
    read: () => draft,
    update,
    replace: (next) => update(() => next),
    finish: () => {
      // close callbacks and unmount cleanup may both finish the same transaction.
      if (finished) return
      finished = true
      if (dirty) commit(reducer)
    },
    reset: (nextSource) => {
      draft = clone(nextSource)
      reducer = identity
      dirty = false
      finished = false
      return draft
    },
    isDirty: () => dirty,
  }
}

export function useConfigurationSession<T>({
  source,
  active = true,
  clone = structuredClone,
  commit,
}: ConfigurationSessionOptions<T>) {
  // keep the transaction stable while its eventual commit uses the latest owner.
  const commitRef = useRef(commit)
  commitRef.current = commit

  const transactionRef = useRef<ConfigurationTransaction<T> | null>(null)
  if (!transactionRef.current) {
    transactionRef.current = createConfigurationTransaction(
      source,
      (reducer) => commitRef.current(reducer),
      clone,
    )
  }
  const transaction = transactionRef.current
  const [draft, setDraft] = useState<T>(() => transaction.read())
  const activeRef = useRef(active)
  const mountGenerationRef = useRef(0)

  const update = useCallback((reducer: ConfigurationReducer<T>) => {
    setDraft(transaction.update(reducer))
  }, [transaction])

  const replace = useCallback((next: T) => {
    setDraft(transaction.replace(next))
  }, [transaction])

  const finish = useCallback(() => {
    transaction.finish()
  }, [transaction])

  useEffect(() => {
    const wasActive = activeRef.current
    activeRef.current = active

    if (!active && wasActive) {
      finish()
      return
    }
    // source updates do not overwrite an active draft. reopening seeds a new one.
    if (!active || wasActive) return

    setDraft(transaction.reset(source))
  }, [active, finish, source, transaction])

  useEffect(() => {
    mountGenerationRef.current += 1

    return () => {
      const cleanupGeneration = ++mountGenerationRef.current
      queueMicrotask(() => {
        // react strict mode immediately re-establishes effects after development
        // cleanup. a genuine owner unmount has no later setup and flushes any
        // open draft.
        if (
          mountGenerationRef.current === cleanupGeneration
          && activeRef.current
        ) {
          transaction.finish()
        }
      })
    }
  }, [transaction])

  return {
    draft,
    update,
    replace,
    finish,
    get dirty() {
      return transaction.isDirty()
    },
  }
}
