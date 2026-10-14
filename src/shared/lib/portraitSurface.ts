/*
  Author: Runor Ewhro
  description: derives a deterministic dark surface color from nontransparent
               portrait pixels and loads remote sources through a cors-safe decode.
*/

const SAMPLE_SIZE = 96
const BASE = [12, 17, 26] as const
const IMAGE_SHARE = 0.35
export const DEFAULT_PORTRAIT_SURFACE = '#0c111a'
const LIGHT_INK = '#eef2f7'
const DARK_INK = '#101318'

// card text colour follows the pinned card surface. unparseable colours use
// light ink for the dark default surface.
export function inkForSurface(surface: string): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(surface.trim())?.[1]
  if (!hex) return LIGHT_INK
  const full = hex.length === 3 ? hex.replace(/./g, '$&$&') : hex
  const [r, g, b] = [0, 2, 4].map((at) => {
    const srgb = parseInt(full.slice(at, at + 2), 16) / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // crossover where light and dark ink reach equal contrast against the surface.
  return luminance > 0.19 ? DARK_INK : LIGHT_INK
}

export function surfaceFromPortraitPixels(pixels: Uint8ClampedArray): string | null {
  let red = 0
  let green = 0
  let blue = 0
  let weightTotal = 0

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255
    if (alpha < 0.12) continue
    const r = pixels[index]
    const g = pixels[index + 1]
    const b = pixels[index + 2]
    const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255
    const weight = alpha * (0.5 + saturation)
    red += r * weight
    green += g * weight
    blue += b * weight
    weightTotal += weight
  }

  if (weightTotal === 0) return null
  const channels = [red, green, blue].map((sum, index) => (
    Math.round(BASE[index] * (1 - IMAGE_SHARE) + sum / weightTotal * IMAGE_SHARE)
      .toString(16).padStart(2, '0')
  ))
  return `#${channels.join('')}`
}

export async function readPortraitSurface(source: string): Promise<string> {
  // a fresh cors-enabled decode also allows hosted uploads to be sampled when
  // their image host permits it; the displayed img may have loaded without cors.
  const sample = new Image()
  sample.crossOrigin = 'anonymous'
  sample.src = source
  try {
    await sample.decode()
  } catch {
    throw new Error('This portrait could not be sampled. Try a local upload.')
  }
  if (!sample.naturalWidth || !sample.naturalHeight) throw new Error('The main portrait could not be read.')

  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = Math.max(1, Math.round(SAMPLE_SIZE * sample.naturalHeight / sample.naturalWidth))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Image color sampling is unavailable.')
  context.drawImage(sample, 0, 0, canvas.width, canvas.height)
  let pixels: Uint8ClampedArray
  try {
    pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  } catch {
    throw new Error('This image host does not allow color sampling.')
  }
  const color = surfaceFromPortraitPixels(pixels)
  if (!color) throw new Error('The main portrait has no visible color to sample.')
  return color
}
