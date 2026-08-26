/*
  Author: Runor Ewhro
  Description: shared numeric helpers for lightweight ui and state shaping.
*/

// clamp a number into an inclusive range
export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// cut decimal display precision without rounding the underlying value upward
export function truncTo(value: number, digits = 0): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  const factor = 10 ** Math.max(0, digits)
  const scaled = value * factor
  /* Values assembled from Float32 stat lanes can land just below an intended
     decimal boundary (for example 50.1f + 49.8f -> 99.8999977). Snap only
     within one Float32 rounding-error bound; meaningful fractions below the
     boundary must still truncate downward. */
  const tolerance = Math.max(
    Number.EPSILON * Math.max(1, Math.abs(scaled)),
    Math.abs(scaled) * (2 ** -24),
  )
  const boundary = Math.round(scaled)
  const normalized = Math.abs(scaled - boundary) <= tolerance ? boundary : scaled
  return Math.trunc(normalized) / factor
}

export function formatTrunc(value: number, digits = 0): string {
  const truncated = truncTo(value, digits)
  return truncated.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatTruncCompact(value: number, digits = 1): string {
  return truncTo(value, digits).toFixed(digits)
}
