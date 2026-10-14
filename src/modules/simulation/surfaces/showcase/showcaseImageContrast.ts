/*
  Author: Runor Ewhro
  description: chooses light or dark text for showcase labels over card artwork.
               samples a small rendering of the current css backdrop beneath
               exposed labels.
*/

import { useEffect, useRef, useState, type RefObject } from 'react'
import type { CssVars } from '@/modules/simulation/workspace/ui.tsx'

const SAMPLE_WIDTH = 96
const LIGHT_INK = '#f8fafc'
const DARK_INK = '#101318'

interface ContrastTarget {
  selector: string
  inkVar: string
  shadowVar: string
}

const CONTRAST_TARGETS: ContrastTarget[] = [
  {
    selector: '.wk-portrait-name',
    inkVar: '--showcase-image-name-ink',
    shadowVar: '--showcase-image-name-shadow',
  },
  {
    selector: '.wk-portrait-lv',
    inkVar: '--showcase-image-level-ink',
    shadowVar: '--showcase-image-level-shadow',
  },
  {
    selector: '.wk-rail-credit',
    inkVar: '--showcase-image-credit-ink',
    shadowVar: '--showcase-image-credit-shadow',
  },
  {
    selector: '.wk-rail-brand',
    inkVar: '--showcase-image-brand-ink',
    shadowVar: '--showcase-image-brand-shadow',
  },
]

interface ContrastChoice {
  ink: typeof LIGHT_INK | typeof DARK_INK
  shadow: string
}

interface BackgroundGeometry {
  width: number
  height: number
  x: number
  y: number
}

const imageCache = new Map<string, Promise<HTMLImageElement>>()

function loadAnalysisImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url)
  if (cached) return cached

  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Showcase backdrop could not be analyzed'))
    image.src = url
  })
  imageCache.set(url, pending)
  void pending.then(
    () => imageCache.delete(url),
    () => imageCache.delete(url),
  )
  return pending
}

function backgroundImageUrl(value: string): string | null {
  const match = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/.exec(value)
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim() || null
}

function parseCssLength(value: string, extent: number): number | null {
  const token = value.trim().toLowerCase()
  if (token.endsWith('%')) {
    const percent = Number.parseFloat(token)
    return Number.isFinite(percent) ? extent * percent / 100 : null
  }
  if (token.endsWith('px')) {
    const pixels = Number.parseFloat(token)
    return Number.isFinite(pixels) ? pixels : null
  }
  const numeric = Number.parseFloat(token)
  return Number.isFinite(numeric) ? numeric : null
}

function splitCssPair(value: string, fallback: string): [string, string] {
  const tokens = value.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return [fallback, fallback]
  if (tokens.length === 1) return [tokens[0], fallback]
  return [tokens[0], tokens[1]]
}

function positionOffset(value: string, remaining: number): number {
  const token = value.trim().toLowerCase()
  if (token === 'left' || token === 'top') return 0
  if (token === 'center') return remaining / 2
  if (token === 'right' || token === 'bottom') return remaining
  if (token.endsWith('%')) {
    const percent = Number.parseFloat(token)
    return Number.isFinite(percent) ? remaining * percent / 100 : remaining / 2
  }
  return parseCssLength(token, remaining) ?? remaining / 2
}

export function resolveBackgroundGeometry(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
  backgroundSize: string,
  backgroundPosition: string,
): BackgroundGeometry {
  const imageRatio = imageWidth / Math.max(1, imageHeight)
  let width: number
  let height: number
  const normalizedSize = backgroundSize.trim().toLowerCase()

  if (normalizedSize === 'cover' || normalizedSize === 'contain') {
    const scale = normalizedSize === 'cover'
      ? Math.max(containerWidth / imageWidth, containerHeight / imageHeight)
      : Math.min(containerWidth / imageWidth, containerHeight / imageHeight)
    width = imageWidth * scale
    height = imageHeight * scale
  } else {
    const [widthToken, heightToken] = splitCssPair(normalizedSize, 'auto')
    const parsedWidth = widthToken === 'auto' ? null : parseCssLength(widthToken, containerWidth)
    const parsedHeight = heightToken === 'auto' ? null : parseCssLength(heightToken, containerHeight)
    if (parsedWidth != null && parsedHeight != null) {
      width = parsedWidth
      height = parsedHeight
    } else if (parsedHeight != null) {
      height = parsedHeight
      width = height * imageRatio
    } else {
      width = parsedWidth ?? imageWidth
      height = width / imageRatio
    }
  }

  const [positionX, positionY] = splitCssPair(backgroundPosition, '50%')
  return {
    width,
    height,
    x: positionOffset(positionX, containerWidth - width),
    y: positionOffset(positionY, containerHeight - height),
  }
}

function channelToLinear(channel: number): number {
  const srgb = channel / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(red: number, green: number, blue: number): number {
  return 0.2126 * channelToLinear(red) + 0.7152 * channelToLinear(green) + 0.0722 * channelToLinear(blue)
}

function contrastRatio(first: number, second: number): number {
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

export function chooseContrastInk(luminances: number[]): ContrastChoice {
  if (luminances.length === 0) {
    return {
      ink: LIGHT_INK,
      shadow: '0 1px 3px rgba(0, 0, 0, 0.92)',
    }
  }

  const sortedLuminances = [...luminances].sort((left, right) => left - right)
  const lightLuminance = relativeLuminance(248, 250, 252)
  const darkLuminance = relativeLuminance(16, 19, 24)
  const lightRatios = luminances.map((value) => contrastRatio(lightLuminance, value)).sort((a, b) => a - b)
  const darkRatios = luminances.map((value) => contrastRatio(darkLuminance, value)).sort((a, b) => a - b)
  const lightScore = percentile(lightRatios, 0.18)
  const darkScore = percentile(darkRatios, 0.18)
  const useLight = lightScore >= darkScore
  const range = percentile(sortedLuminances, 0.9) - percentile(sortedLuminances, 0.1)
  const shadowAlpha = range > 0.35 || Math.max(lightScore, darkScore) < 4.5 ? 0.92 : 0.68

  return useLight
    ? {
        ink: LIGHT_INK,
        shadow: `0 1px 2px rgba(0, 0, 0, ${shadowAlpha}), 0 0 8px rgba(0, 0, 0, ${shadowAlpha * 0.72})`,
      }
    : {
        ink: DARK_INK,
        shadow: `0 1px 2px rgba(255, 255, 255, ${shadowAlpha}), 0 0 8px rgba(255, 255, 255, ${shadowAlpha * 0.64})`,
      }
}

function resolveCanvasColor(context: CanvasRenderingContext2D, value: string): string {
  context.fillStyle = '#101318'
  context.fillStyle = value.trim() || '#101318'
  return context.fillStyle
}

function scaledFilter(value: string, scale: number): string {
  return value.replace(/blur\(([\d.]+)px\)/g, (_match, radius: string) => {
    const parsed = Number.parseFloat(radius)
    return `blur(${Math.max(0, parsed * scale).toFixed(2)}px)`
  })
}

function sampleTarget(
  data: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  cardRect: DOMRect,
  targetRect: DOMRect,
): number[] {
  if (cardRect.width <= 0 || cardRect.height <= 0 || targetRect.width <= 0 || targetRect.height <= 0) return []
  const left = Math.max(0, Math.floor((targetRect.left - cardRect.left) / cardRect.width * canvasWidth))
  const right = Math.min(canvasWidth, Math.ceil((targetRect.right - cardRect.left) / cardRect.width * canvasWidth))
  const top = Math.max(0, Math.floor((targetRect.top - cardRect.top) / cardRect.height * canvasHeight))
  const bottom = Math.min(canvasHeight, Math.ceil((targetRect.bottom - cardRect.top) / cardRect.height * canvasHeight))
  const luminances: number[] = []

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * canvasWidth + x) * 4
      if (data[index + 3] < 16) continue
      luminances.push(relativeLuminance(data[index], data[index + 1], data[index + 2]))
    }
  }
  return luminances
}

async function analyzeCardBackdrop(card: HTMLElement, canvas: HTMLCanvasElement, load: typeof loadAnalysisImage, active: () => boolean): Promise<CssVars> {
  const backdrop = card.querySelector<HTMLElement>('.wk-portrait-bg')
  if (!backdrop) return {}
  const backdropStyle = getComputedStyle(backdrop)
  const url = backgroundImageUrl(backdropStyle.backgroundImage)
  if (!url) return {}

  const image = await load(url)
  if (!active()) return {}
  const cardRect = card.getBoundingClientRect()
  const backdropRect = backdrop.getBoundingClientRect()
  if (cardRect.width <= 0 || cardRect.height <= 0 || backdropRect.width <= 0 || backdropRect.height <= 0) return {}

  canvas.width = SAMPLE_WIDTH
  canvas.height = Math.max(1, Math.round(SAMPLE_WIDTH * cardRect.height / cardRect.width))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return {}

  const scaleX = canvas.width / cardRect.width
  const scaleY = canvas.height / cardRect.height
  const cardStyle = getComputedStyle(card)
  context.fillStyle = resolveCanvasColor(context, cardStyle.getPropertyValue('--bg'))
  context.fillRect(0, 0, canvas.width, canvas.height)

  const geometry = resolveBackgroundGeometry(
    backdropRect.width,
    backdropRect.height,
    image.naturalWidth,
    image.naturalHeight,
    backdropStyle.backgroundSize,
    backdropStyle.backgroundPosition,
  )
  context.save()
  context.globalAlpha = Number.parseFloat(backdropStyle.opacity) || 0
  context.filter = scaledFilter(backdropStyle.filter, Math.min(scaleX, scaleY))
  context.drawImage(
    image,
    (backdropRect.left - cardRect.left + geometry.x) * scaleX,
    (backdropRect.top - cardRect.top + geometry.y) * scaleY,
    geometry.width * scaleX,
    geometry.height * scaleY,
  )
  context.restore()

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const vars: CssVars = {}
  for (const target of CONTRAST_TARGETS) {
    const element = card.querySelector<HTMLElement>(target.selector)
    if (!element) continue
    const choice = chooseContrastInk(sampleTarget(pixels, canvas.width, canvas.height, cardRect, element.getBoundingClientRect()))
    vars[target.inkVar] = choice.ink
    vars[target.shadowVar] = choice.shadow
  }
  return vars
}

const EMPTY_VARS: CssVars = {}

export function useShowcaseImageContrast(cardRef: RefObject<HTMLElement | null>, enabled: boolean, watchKey: string): CssVars {
  const [vars, setVars] = useState<CssVars>(EMPTY_VARS)
  const scheduleRef = useRef<(() => void) | null>(null)
  useEffect(() => { scheduleRef.current?.() }, [watchKey])
  useEffect(() => {
    const card = cardRef.current
    if (!enabled || !card) return
    const canvas = document.createElement('canvas')
    let disposed = false
    let frame = 0
    let running = false
    let pending = false
    let imageSource = ''
    let image: Promise<HTMLImageElement> | null = null
    let lastSignature = ''
    const load = (url: string) => {
      if (!image || url !== imageSource) { imageSource = url; image = loadAnalysisImage(url) }
      return image
    }
    const signature = () => {
      const backdrop = card.querySelector<HTMLElement>('.wk-portrait-bg')
      if (!backdrop) return ''
      const style = getComputedStyle(backdrop)
      const rect = card.getBoundingClientRect()
      return JSON.stringify([style.backgroundImage, style.backgroundSize, style.backgroundPosition, style.opacity, style.filter,
        getComputedStyle(card).getPropertyValue('--bg'), rect.width, rect.height,
        ...CONTRAST_TARGETS.map(({ selector }) => {
          const r = card.querySelector(selector)?.getBoundingClientRect()
          return r ? [r.x - rect.x, r.y - rect.y, r.width, r.height] : null
        })])
    }
    const analyze = async () => {
      frame = 0
      if (disposed) return
      if (running) { pending = true; return }
      const next = signature()
      if (next === lastSignature) return
      running = true
      pending = false
      try {
        const result = await analyzeCardBackdrop(card, canvas, load, () => !disposed)
        if (!disposed && next === signature()) {
          lastSignature = next
          setVars((previous) => JSON.stringify(previous) === JSON.stringify(result) ? previous : result)
        } else if (!disposed) pending = true
      } catch { if (!disposed) setVars(EMPTY_VARS) }
      finally {
        running = false
        if (disposed) { canvas.width = 0; canvas.height = 0; image = null }
        else if (pending) schedule()
      }
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { void analyze() }) }
    scheduleRef.current = schedule
    const resize = new ResizeObserver(schedule)
    resize.observe(card)
    const targets = new MutationObserver(() => { observeTargets(); schedule() })
    const observed = new Set<Element>()
    const observeTargets = () => {
      const next = new Set(CONTRAST_TARGETS.flatMap(({ selector }) => [...card.querySelectorAll(selector)]))
      for (const old of observed) if (!next.has(old)) { resize.unobserve(old); observed.delete(old) }
      for (const node of next) if (!observed.has(node)) { resize.observe(node); observed.add(node) }
    }
    // only target insertion/removal needs a subtree observer. Geometry/signature
    // checks prevent unrelated score changes from decoding or sampling artwork.
    targets.observe(card, { childList: true, subtree: true })
    card.addEventListener('showcase:typography', schedule)
    card.addEventListener('showcase:appearance', schedule)
    observeTargets(); schedule()
    return () => {
      disposed = true; scheduleRef.current = null; cancelAnimationFrame(frame)
      resize.disconnect(); targets.disconnect(); observed.clear()
      card.removeEventListener('showcase:typography', schedule)
      card.removeEventListener('showcase:appearance', schedule)
      if (!running) { canvas.width = 0; canvas.height = 0; image = null }
    }
  }, [cardRef, enabled])
  return enabled ? vars : EMPTY_VARS
}
