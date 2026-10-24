/*
  Author: Runor Ewhro
  description: provides helpers for reading and writing nested runtime state
               values using dot-path access.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import type { RuntimeValue } from '@/domain/gameData/contracts'

// normalize a runtime path into key segments
const runtimePathSegments = new Map<string, string[]>()
function normPath(path: string): string[] {
  const cached = runtimePathSegments.get(path)
  if (cached) return cached
  const keys = path.replace(/^runtime\./, '').split('.').filter(Boolean)
  if (runtimePathSegments.size >= 2048) runtimePathSegments.clear()
  runtimePathSegments.set(path, keys)
  return keys
}

function shldUseRryCn(key: string): boolean {
  return /^\d+$/.test(key)
}

function cloneCntn<T extends Record<string, unknown> | unknown[]>(value: T): T {
  return (Array.isArray(value) ? [...value] : { ...value }) as T
}

function writeNstdPat(
    current: unknown,
    keys: string[],
    value: unknown,
    depth = 0,
): unknown {
  if (depth === keys.length) {
    return Object.is(current, value) ? current : value
  }

  const key = keys[depth]!
  const source =
      current && typeof current === 'object'
          ? current as Record<string, unknown> | unknown[]
          : shldUseRryCn(key)
              ? []
              : {}
  const childBefore = (source as Record<string, unknown>)[key]
  const childAfter = writeNstdPat(childBefore, keys, value, depth + 1)

  if (childAfter === childBefore && source === current) {
    return current
  }

  const next = cloneCntn(source)
  ;(next as Record<string, unknown>)[key] = childAfter
  return next
}

export function writeBjctPat<T extends Record<string, unknown> | unknown[]>(
    value: T,
    keys: string[],
    nextValue: unknown,
): T {
  if (keys.length === 0) {
    return value
  }

  return writeNstdPat(value, keys, nextValue) as T
}

// read a nested value from runtime state
export function readRtPath(runtime: ResRuntime, path: string): unknown {
  let cursor: unknown = runtime

  for (const key of normPath(path)) {
    if (!cursor || typeof cursor !== 'object') {
      return undefined
    }

    cursor = (cursor as Record<string, unknown>)[key]
  }

  return cursor
}

// write a nested value into runtime state immutably
export function writeRtPath(
    runtime: ResRuntime,
    path: string,
    value: RuntimeValue,
): ResRuntime {
  const keys = normPath(path)
  if (keys.length === 0) {
    return runtime
  }

  return writeBjctPat(runtime as unknown as Record<string, unknown>, keys, value) as unknown as ResRuntime
}

/** apply an ordered overlay, copying each shared ancestor at most once. */
export function writeRtPaths(runtime: ResRuntime, paths: Readonly<Record<string, RuntimeValue>>): ResRuntime {
  const owned = new WeakSet<object>()
  const write = (current: unknown, keys: string[], depth: number, value: RuntimeValue): unknown => {
    if (depth === keys.length) return Object.is(current, value) ? current : value
    const key = keys[depth]!
    const source = current && typeof current === 'object'
      ? current as Record<string, unknown>
      : shldUseRryCn(key) ? [] : {}
    const before = (source as Record<string, unknown>)[key]
    const after = write(before, keys, depth + 1, value)
    if (after === before && source === current) return current
    const next = owned.has(source) ? source : cloneCntn(source)
    owned.add(next)
    ;(next as Record<string, unknown>)[key] = after
    return next
  }
  let next = runtime
  for (const [path, value] of Object.entries(paths)) {
    const keys = normPath(path)
    if (keys.length > 0) next = write(next, keys, 0, value) as ResRuntime
  }
  return next
}
