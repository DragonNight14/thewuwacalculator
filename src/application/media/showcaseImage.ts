/*
  Author: Runor Ewhro
  description: resolves disposable display derivatives while preserving original showcase artwork for capture.
*/
import { resolveImageRef } from './imageUpload'
import { loadMgBlob, saveMgBlob } from '@/infra/persistence/blobImageStore'

export interface ShowcaseImage { url: string; original: string; release: () => void }
export async function resolveShowcaseImage(ref: string, edge: number, signal: AbortSignal): Promise<ShowcaseImage | null> {
  const key = `showcase-display-v1:${edge}:${ref}`
  const cached = ref.startsWith('upload:') ? await loadMgBlob(key) : null
  signal.throwIfAborted()
  if (cached) {
    const url = URL.createObjectURL(cached)
    return { url, original: ref, release: () => URL.revokeObjectURL(url) }
  }
  const original = await resolveImageRef(ref)
  if (!original) return null
  let bitmap: ImageBitmap | null = null
  let display: string | null = null
  let canvas: HTMLCanvasElement | null = null
  const release = () => { if (display) URL.revokeObjectURL(display); original.revoke?.() }
  try {
    signal.throwIfAborted()
    // stable local uploads can reuse derivatives without decoding the original.
    let blob: Blob | null = null
    if (!blob) {
      const response = await fetch(original.url, { signal })
      if (!response.ok) throw new Error('Image unavailable')
      const source = await response.blob()
      signal.throwIfAborted()
      const header = new Uint8Array(await source.slice(0, 1024).arrayBuffer())
      const tags = new TextDecoder('latin1').decode(header)
      if (/gif|svg/.test(source.type) || tags.includes('ANIM') || tags.includes('acTL')) return { url: original.url, original: original.url, release }
      bitmap = await createImageBitmap(source)
      signal.throwIfAborted()
      if (Math.max(bitmap.width, bitmap.height) <= edge) return { url: original.url, original: original.url, release }
      const ratio = edge / Math.max(bitmap.width, bitmap.height)
      canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Image canvas unavailable')
      context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close(); bitmap = null
      blob = await new Promise<Blob | null>((resolve) => canvas!.toBlob(resolve, 'image/png'))
      signal.throwIfAborted()
      if (!blob) throw new Error('Image conversion unavailable')
      if (ref.startsWith('upload:')) await saveMgBlob(key, blob).catch(() => {})
    }
    signal.throwIfAborted()
    display = URL.createObjectURL(blob)
    original.revoke?.()
    return { url: display, original: ref, release }
  } catch (error) {
    if (signal.aborted) { release(); throw error }
    // cross-origin artwork that cannot be sampled retains its working url.
    return { url: original.url, original: original.url, release }
  } finally {
    bitmap?.close()
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}
