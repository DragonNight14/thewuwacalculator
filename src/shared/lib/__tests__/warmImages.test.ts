/*
  Author: Runor Ewhro
  description: protects shared warming concurrency, cancellation and retry behavior.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeImage {
  static instances: FakeImage[] = []
  src = ''
  decoding = ''
  fetchPriority = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  decode = vi.fn(async () => undefined)
  constructor() { FakeImage.instances.push(this) }
}
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve() }
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  FakeImage.instances = []
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  vi.stubGlobal('navigator', { connection: { effectiveType: '4g' } })
  vi.stubGlobal('Image', FakeImage)
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('image warming', () => {
  it('shares four active lanes and drops only cancelled queued requests', async () => {
    const { warmImages } = await import('../warmImages')
    const cancel = warmImages(['a', 'b', 'c', 'd', 'e', 'f'])
    warmImages(['a', 'e', 'g'])
    expect(FakeImage.instances.map((image) => image.src)).toEqual(['a', 'b', 'c', 'd'])
    cancel()
    FakeImage.instances[0].onload?.()
    await flush()
    expect(FakeImage.instances.map((image) => image.src)).toEqual(['a', 'b', 'c', 'd', 'e'])
    FakeImage.instances[1].onload?.()
    await flush()
    expect(FakeImage.instances.at(-1)?.src).toBe('g')
    expect(FakeImage.instances.some((image) => image.src === 'f')).toBe(false)
  })
  it('retries failures and deduplicates successful decodes', async () => {
    const { warmImages } = await import('../warmImages')
    warmImages(['a', 'a'])
    FakeImage.instances[0].onerror?.()
    await flush()
    warmImages(['a'])
    expect(FakeImage.instances).toHaveLength(2)
    FakeImage.instances[1].onload?.()
    await flush()
    warmImages(['a'])
    expect(FakeImage.instances).toHaveLength(2)
  })
  it('releases timed-out lanes and respects data-saving connections', async () => {
    const { warmImages } = await import('../warmImages')
    warmImages(['a', 'b', 'c', 'd', 'e'])
    await vi.advanceTimersByTimeAsync(15_000)
    expect(FakeImage.instances.at(-1)?.src).toBe('e')
    vi.stubGlobal('navigator', { connection: { saveData: true } })
    warmImages(['z'])
    expect(FakeImage.instances.some((image) => image.src === 'z')).toBe(false)
  })
})
