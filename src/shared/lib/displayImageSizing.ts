/*
  Author: Runor Ewhro
  description: selects generated image derivatives from measured display size and
               pixel density while sharing observers across mounted images.
*/
import { resolveDisplayImage } from './displayAssets'

const sources = new Map<HTMLImageElement, string>()
const selectedSources = new WeakMap<HTMLImageElement, string>()
// only images whose size may have changed are measured. reading every mounted
// image forces layout of skipped content-visibility subtrees (a whole picker).
const pending = new Set<HTMLImageElement>()
let pendingAll = false
let observer: ResizeObserver | undefined
let densityQuery: MediaQueryList | undefined
let frame: number | undefined

export function currentPixelRatio() {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
}

export function loadDisplayImage(image: HTMLImageElement, source: string) {
  const width = image.getBoundingClientRect().width
  if (width <= 0) return
  const asset = resolveDisplayImage(source, width, currentPixelRatio())
  image.removeAttribute('srcset')
  image.removeAttribute('sizes')
  if (image.getAttribute('src') !== asset.src) image.src = asset.src
  selectedSources.set(image, asset.src)
}

function refresh() {
  frame = undefined
  const images = pendingAll ? [...sources.keys()] : [...pending].filter((image) => sources.has(image))
  pending.clear()
  pendingAll = false
  // read all layout bounds before changing any image urls.
  const widths = images.map((image) => image.getBoundingClientRect().width)
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]!
    const source = sources.get(image)
    const width = widths[index] ?? 0
    if (!source) continue
    // a failed derivative falls back to canonical art until the source changes.
    const current = image.getAttribute('src')
    if (width <= 0 || (current && current !== selectedSources.get(image))) continue
    const asset = resolveDisplayImage(source, width, currentPixelRatio())
    if (image.getAttribute('src') !== asset.src) image.src = asset.src
    selectedSources.set(image, asset.src)
  }
}

function scheduleRefresh(images?: Iterable<HTMLImageElement>) {
  if (images) for (const image of images) pending.add(image)
  else pendingAll = true
  if (frame === undefined) frame = window.requestAnimationFrame(refresh)
}

function refreshAll() {
  scheduleRefresh()
}

function onResize(entries: ResizeObserverEntry[]) {
  scheduleRefresh(entries.map((entry) => entry.target as HTMLImageElement))
}

function onGeometryTransition(event: TransitionEvent) {
  // layout size changes already reach ResizeObserver. only transforms can
  // change a measured display width without changing the layout box, and only
  // for images inside the transitioned element.
  if (event.propertyName !== 'transform' && event.propertyName !== 'scale') return
  const target = event.target as Node | null
  if (!target?.contains) return
  const moved = [...sources.keys()].filter((image) => target.contains(image))
  if (moved.length) scheduleRefresh(moved)
}

function watchDensity() {
  densityQuery?.removeEventListener('change', onDensityChange)
  densityQuery = window.matchMedia?.(`(resolution: ${currentPixelRatio()}dppx)`)
  densityQuery?.addEventListener('change', onDensityChange)
}

function onDensityChange() {
  watchDensity()
  refreshAll()
}

export function observeDisplayImage(image: HTMLImageElement, source: string) {
  if (!resolveDisplayImage(source, 0).srcSet) {
    if (image.getAttribute('src') !== source) image.src = source
    return () => {}
  }
  if (sources.size === 0) {
    observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(onResize)
    window.addEventListener('resize', refreshAll)
    // transforms can change displayed width without changing the layout box.
    document.addEventListener('transitionend', onGeometryTransition)
    watchDensity()
  }
  sources.set(image, source)
  // the observer's first report picks the source once the image has a layout
  // box. measuring here forces layout per image, and content-visibility
  // skipped images are only reported once they near the viewport.
  if (observer) observer.observe(image)
  else loadDisplayImage(image, source)
  return () => {
    sources.delete(image)
    pending.delete(image)
    observer?.unobserve(image)
    if (sources.size) return
    pendingAll = false
    observer?.disconnect()
    observer = undefined
    window.removeEventListener('resize', refreshAll)
    document.removeEventListener('transitionend', onGeometryTransition)
    densityQuery?.removeEventListener('change', onDensityChange)
    densityQuery = undefined
    if (frame !== undefined) window.cancelAnimationFrame(frame)
    frame = undefined
  }
}
