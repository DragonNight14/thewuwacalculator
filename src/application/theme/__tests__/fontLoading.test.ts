/*
  Author: Runor Ewhro
  description: protects selected-font loading and capture's stylesheet barrier.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class Link extends EventTarget {
  href = ''
  rel = ''
  as = ''
  type = ''
  crossOrigin = ''
  dataset: Record<string, string> = {}
}
let links: Link[] = []
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  links = []
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  vi.stubGlobal('document', {
    querySelectorAll: () => links,
    createElement: () => new Link(),
    head: { appendChild: (link: Link) => links.push(link) },
    documentElement: { style: { setProperty: vi.fn() } },
  })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('font resource loading', () => {
  it('does not preload the default game font for a system-font user', async () => {
    const { applyBodyFon } = await import('../typography')
    await applyBodyFon('System UI', '')
    expect(links.some((link) => link.href.includes('kurogame'))).toBe(false)
    await applyBodyFon('Wuthering Waves', '')
    await applyBodyFon('Wuthering Waves', '')
    expect(links.filter((link) => link.rel === 'preload')).toHaveLength(1)
    expect(links.filter((link) => link.rel === 'stylesheet')).toHaveLength(1)
  })
  it('does not let a slow previous font selection overwrite the current one', async () => {
    const { applyBodyFon } = await import('../typography')
    const old = applyBodyFon('Old Font', 'https://fonts.googleapis.com/css2?family=Old+Font&display=swap')
    await applyBodyFon('System UI', '')
    const latest = vi.mocked(document.documentElement.style.setProperty).mock.calls.slice()
    links.find((link) => link.href.includes('Old+Font'))!.dispatchEvent(new Event('load'))
    await old
    expect(vi.mocked(document.documentElement.style.setProperty).mock.calls).toEqual(latest)
  })
  it('reuses the standard stylesheet for custom stacks naming an existing family', async () => {
    const { ensureAppFonts, ensureGoogleFamily } = await import('../typography')
    ensureAppFonts()
    ensureGoogleFamily('Roboto Mono')
    ensureGoogleFamily('Chakra Petch')
    expect(links.filter((link) => link.rel === 'stylesheet')).toHaveLength(1)
  })
  it('waits for newly requested stylesheets before capture proceeds', async () => {
    const { ensureShowcaseFonts, waitForFontStylesheets } = await import('../typography')
    ensureShowcaseFonts()
    ensureShowcaseFonts()
    expect(links).toHaveLength(1)
    let done = false
    const wait = waitForFontStylesheets().then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    links[0].dispatchEvent(new Event('load'))
    await wait
    expect(done).toBe(true)
  })
  it('allows fallback fonts after stylesheet errors or a stalled connection', async () => {
    const { ensureShowcaseFonts, ensureAppFonts, waitForFontStylesheets } = await import('../typography')
    ensureShowcaseFonts()
    links[0].dispatchEvent(new Event('error'))
    await waitForFontStylesheets()
    ensureAppFonts()
    const wait = waitForFontStylesheets()
    await vi.advanceTimersByTimeAsync(8000)
    await wait
  })
})
