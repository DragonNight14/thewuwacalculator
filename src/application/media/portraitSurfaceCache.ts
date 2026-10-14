/*
  Author: Runor Ewhro
  description: caches derived portrait colors by stable image reference while
               coalescing concurrent sampling and tolerating unavailable storage.
*/

import { loadImageSurface, saveImageSurface } from '@/infra/persistence/blobImageStore.ts'
import { DEFAULT_PORTRAIT_SURFACE, readPortraitSurface } from '@/shared/lib/portraitSurface.ts'

const pending = new Map<string, Promise<string>>()
const MAX_SURFACES = 32

// use the persisted upload ref, never its temporary resolved blob url. legacy
// uploads and pasted urls acquire metadata on first use without a migration.
export function readCachedPortraitSurface(imageRef: string, source: string): Promise<string> {
  const key = `portrait-surface-v1:${imageRef}`
  const existing = pending.get(key)
  if (existing) return existing
  const persistent = !imageRef.startsWith('blob:')
  const result = (async () => {
    if (persistent) {
      const cached = await loadImageSurface(key).catch(() => null)
      if (cached) return cached
    }
    const color = await readPortraitSurface(source)
    if (persistent) await saveImageSurface(key, color).catch(() => undefined)
    return color
  })().catch(() => {
    // a revoked temporary url or transient network error must not poison the
    // stable image ref when it is resolved again later.
    pending.delete(key)
    return DEFAULT_PORTRAIT_SURFACE
  })
  // also coalesce concurrent requests and retain session-only results.
  pending.set(key, result)
  while (pending.size > MAX_SURFACES) pending.delete(pending.keys().next().value!)
  return result
}
