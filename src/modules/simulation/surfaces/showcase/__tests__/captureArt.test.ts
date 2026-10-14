/*
  Author: Runor Ewhro
  description: verifies full-quality capture resource replacement, decode ordering,
               clone independence, and cleanup across successful and failed rasterization.
*/

import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadCaptureArt, renderBuildCardPng } from '../captureBuildCard.ts'

const rasterize = vi.hoisted(() => vi.fn())
vi.mock('../captureRaster', () => ({ rasterizeCard: rasterize }))

const full = '/assets/game/resonators/spine/setup/luckdraw/1506.webp'
const preview = 'https://calculator.example/assets/game/resonators/spine/setup/display/luckdraw/1506.webp'

function fixture(custom = false) {
  const image = {
    src: custom ? 'blob:custom' : preview,
    dataset: custom ? {} : { captureSrc: full },
    removeAttribute: vi.fn(),
    decode: vi.fn<() => Promise<void>>(async () => undefined),
  }
  const background = {
    dataset: { captureBackground: full },
    style: { backgroundImage: `url("${custom ? 'https://images.example/custom.webp' : preview}")` },
  }
  const card = {
    querySelectorAll: (selector: string) => {
      if (selector === 'img[data-capture-src]') return custom ? [] : [image]
      if (selector === '[data-capture-background]') return [background]
      if (selector === 'img') return [image]
      throw new Error(`Unexpected selector ${selector}`)
    },
  } as unknown as HTMLElement
  vi.stubGlobal('document', { baseURI: 'https://calculator.example/showcase' })
  vi.stubGlobal('FileReader', class {
    result = 'data:image/webp;base64,full-quality'
    onload?: () => void
    readAsDataURL() { queueMicrotask(() => this.onload?.()) }
  })
  return { image, background, card }
}

afterEach(() => vi.unstubAllGlobals())

describe('capture art loading', () => {
  it('embeds full-quality foreground and background with a single download', async () => {
    const { card, image, background } = fixture()
    const fetch = vi.fn(async () => new Response(new Blob(['full-quality'])))
    vi.stubGlobal('fetch', fetch)
    await loadCaptureArt(card)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(full)
    expect(image.src).toBe('data:image/webp;base64,full-quality')
    expect(background.style.backgroundImage).toBe(`url("${image.src}")`)
    expect(image.removeAttribute).toHaveBeenCalledWith('srcset')
    expect(image.removeAttribute).toHaveBeenCalledWith('sizes')
    expect(image.decode).toHaveBeenCalled()
  })

  it('preserves custom portraits and CSS background overrides', async () => {
    const { card, image, background } = fixture(true)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await loadCaptureArt(card)
    expect(fetch).not.toHaveBeenCalled()
    expect(image.src).toBe('blob:custom')
    expect(background.style.backgroundImage).toBe('url("https://images.example/custom.webp")')
  })

  it('retains additional CSS background layers when upgrading the setup image', async () => {
    const { card, background } = fixture()
    background.style.backgroundImage = `linear-gradient(red, blue), url("${preview}")`
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['full-quality']))))
    await loadCaptureArt(card)
    expect(background.style.backgroundImage)
      .toBe('linear-gradient(red, blue), url("data:image/webp;base64,full-quality")')
  })

  it('fails capture when the master image is missing', async () => {
    const { card } = fixture()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    await expect(loadCaptureArt(card)).rejects.toThrow('full-quality portrait could not be loaded')
  })

  it('waits for the replacement image to decode before allowing rasterization', async () => {
    const { card, image } = fixture()
    let finishDecode!: () => void
    const decode = new Promise<void>((resolve) => { finishDecode = resolve })
    image.decode.mockImplementation(() => decode)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['full-quality']))))
    let ready = false
    const capture = loadCaptureArt(card).then(() => { ready = true })
    await vi.waitFor(() => expect(image.decode).toHaveBeenCalled())
    expect(ready).toBe(false)
    finishDecode()
    await capture
    expect(ready).toBe(true)
  })
})

describe('capture DOM references', () => {
  it.each([false, true])('uses a disposable copy and cleans up (render failure: %s)', async (fail) => {
    // no layout simulation: this protects the source/copy independence contract
    // across the asynchronous renderer, including its failure cleanup.
    const card = {
      style: { setProperty: vi.fn() }, dataset: {}, setAttribute: vi.fn(), appendChild: vi.fn(), insertBefore: vi.fn(),
      querySelectorAll: () => [], querySelector: () => null,
    }
    const source = Object.freeze({
      style: Object.freeze({}), dataset: Object.freeze({}),
      offsetWidth: 1000, offsetHeight: 600,
      cloneNode: vi.fn(() => card),
      querySelectorAll: () => [], querySelector: () => null,
    })
    const host = { style: {}, setAttribute: vi.fn(), appendChild: vi.fn(), remove: vi.fn() }
    const append = vi.fn()
    vi.stubGlobal('document', {
      fonts: { ready: Promise.resolve() }, styleSheets: [], querySelectorAll: () => [],
      createElement: (tag: string) => tag === 'style' ? { textContent: '' } : host, body: { appendChild: append },
    })
    vi.stubGlobal('getComputedStyle', () => [])
    vi.stubGlobal('HTMLImageElement', class {})
    vi.stubGlobal('HTMLCanvasElement', class {})
    const png = new Blob(['png'], { type: 'image/png' })
    rasterize.mockReset()
    if (fail) rasterize.mockRejectedValue(new Error('Rasterization failed'))
    else rasterize.mockResolvedValue(png)

    const result = renderBuildCardPng(source as unknown as HTMLElement)
    if (fail) await expect(result).rejects.toThrow('Rasterization failed')
    else expect(await result).toBe(png)
    expect(rasterize).toHaveBeenCalledWith(card, expect.objectContaining({
      pixelRatio: 3, width: 1000, height: 600,
    }))
    expect(host.appendChild).toHaveBeenCalledWith(card)
    expect(append).toHaveBeenCalledWith(host)
    expect(host.remove).toHaveBeenCalledTimes(1)
    expect(source.dataset).toEqual({})
    expect(source.style).toEqual({})
  })
})
