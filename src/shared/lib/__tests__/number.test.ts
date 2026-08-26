import { describe, expect, it } from 'vitest'
import { formatTruncCompact, truncTo } from '@/shared/lib/number.ts'

describe('truncTo', () => {
  it('normalizes Float32 accumulation noise at a decimal boundary', () => {
    const critRate = Math.fround(50.1) + Math.fround(49.8)

    expect(critRate).toBeLessThan(99.9)
    expect(truncTo(critRate, 1)).toBe(99.9)
    expect(formatTruncCompact(critRate, 1)).toBe('99.9')
  })

  it('still truncates meaningful fractions below a boundary', () => {
    expect(truncTo(99.8994, 1)).toBe(99.8)
    expect(formatTruncCompact(99.8994, 1)).toBe('99.8')
  })

  it('preserves exact caller decimals affected only by Float64 representation', () => {
    expect(truncTo(33.37, 2)).toBe(33.37)
  })

  it('normalizes negative Float32 noise symmetrically', () => {
    const value = -(Math.fround(50.1) + Math.fround(49.8))

    expect(truncTo(value, 1)).toBe(-99.9)
  })

  it('keeps the existing non-finite fallback', () => {
    expect(truncTo(Number.NaN, 1)).toBe(0)
    expect(truncTo(Number.POSITIVE_INFINITY, 1)).toBe(0)
  })
})
