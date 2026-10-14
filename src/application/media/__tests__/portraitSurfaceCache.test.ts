/*
  Author: Runor Ewhro
  description: verifies persistent and session portrait-color caching, request
               coalescing, reference isolation, and recovery after sampling failures.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  stored: new Map<string, string>(),
  load: vi.fn<(key: string) => Promise<string | null>>(),
  save: vi.fn<(key: string, color: string) => Promise<void>>(),
  sample: vi.fn<(source: string) => Promise<string>>(),
}))
vi.mock('@/infra/persistence/blobImageStore.ts', () => ({
  loadImageSurface: mocks.load,
  saveImageSurface: mocks.save,
}))
vi.mock('@/shared/lib/portraitSurface.ts', () => ({
  DEFAULT_PORTRAIT_SURFACE: '#0c111a',
  readPortraitSurface: mocks.sample,
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.stored.clear()
  mocks.load.mockImplementation(async (key) => mocks.stored.get(key) ?? null)
  mocks.save.mockImplementation(async (key, color) => { mocks.stored.set(key, color) })
  mocks.sample.mockResolvedValue('#123456')
})

describe('portrait surface persistence', () => {
  it.each(['upload:legacy-image', 'https://images.example/portrait.webp'])(
    'reuses %s after reload even when its resolved blob URL changes', async (ref) => {
      const first = await import('../portraitSurfaceCache.ts')
      expect(await first.readCachedPortraitSurface(ref, 'blob:first')).toBe('#123456')
      vi.resetModules()
      const reloaded = await import('../portraitSurfaceCache.ts')
      expect(await reloaded.readCachedPortraitSurface(ref, 'blob:second')).toBe('#123456')
      expect(mocks.sample).toHaveBeenCalledTimes(1)
      expect(mocks.save).toHaveBeenCalledTimes(1)
    },
  )

  it('coalesces concurrent sampling and keeps session images out of persistence', async () => {
    const { readCachedPortraitSurface } = await import('../portraitSurfaceCache.ts')
    const first = readCachedPortraitSurface('blob:session', 'blob:session')
    expect(readCachedPortraitSurface('blob:session', 'blob:session')).toBe(first)
    expect(await first).toBe('#123456')
    expect(mocks.sample).toHaveBeenCalledTimes(1)
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('isolates different image references', async () => {
    const { readCachedPortraitSurface } = await import('../portraitSurfaceCache.ts')
    await readCachedPortraitSurface('upload:a', 'blob:a')
    mocks.sample.mockResolvedValue('#654321')
    expect(await readCachedPortraitSurface('upload:b', 'blob:b')).toBe('#654321')
    expect(await readCachedPortraitSurface('upload:a', 'blob:a2')).toBe('#123456')
  })

  it('still returns the sampled color when browser storage is unavailable', async () => {
    mocks.load.mockRejectedValue(new Error('Storage unavailable'))
    mocks.save.mockRejectedValue(new Error('Storage unavailable'))
    const { readCachedPortraitSurface } = await import('../portraitSurfaceCache.ts')
    expect(await readCachedPortraitSurface('upload:a', 'blob:a')).toBe('#123456')
  })

  it('does not persist transient decoding/CORS failures as image colors', async () => {
    mocks.sample.mockRejectedValue(new Error('Decode failed'))
    const { readCachedPortraitSurface } = await import('../portraitSurfaceCache.ts')
    expect(await readCachedPortraitSurface('upload:a', 'blob:a')).toBe('#0c111a')
    expect(mocks.save).not.toHaveBeenCalled()
    mocks.sample.mockResolvedValue('#123456')
    expect(await readCachedPortraitSurface('upload:a', 'blob:new')).toBe('#123456')
  })
})
