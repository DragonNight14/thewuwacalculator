/*
  Author: Runor Ewhro
  description: preserves canonical art identity and responsive derivative selection.
*/
import { describe, expect, it } from 'vitest'
import { resolveDisplayImage } from '../displayAssets'

describe('display asset resolution', () => {
  it.each(['https://example.org/art.webp', 'blob:art', 'upload:art', 'data:image/png;base64,abc', '/assets/missing.webp'])('passes through custom or unknown art: %s', (source) => {
    expect(resolveDisplayImage(source)).toEqual({ src: source })
  })
  it('selects physical pixels for density while retaining all candidates', () => {
    const source = '/assets/game/attributes/icons/glacio.webp'
    const small = resolveDisplayImage(source, 28, 2)
    const large = resolveDisplayImage(source, 61, 2)
    expect(small.width).toBe(64)
    expect(large.width).toBe(128)
    expect(small.srcSet).toBe(large.srcSet)
    expect(small.src).toMatch(/^\/assets\/display\/[a-f\d]+-64.webp$/)
    expect(resolveDisplayImage(source, 1000).width).toBe(256)
  })
  it.each([
    [26, 2, 64], [34, 2, 64], [48, 2, 64], [49, 2, 128],
    [100, 2, 256], [26, 3, 64], [34, 3, 128],
  ])('uses the closest tier for %spx at %sx density', (width, density, expected) => {
    expect(resolveDisplayImage('/assets/game/attributes/icons/glacio.webp', width, density).width).toBe(expected)
  })
})
