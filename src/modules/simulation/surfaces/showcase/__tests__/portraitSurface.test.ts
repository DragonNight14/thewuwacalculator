/*
  Author: Runor Ewhro
  description: keeps bundled portrait surface lookup complete without browser
               image decoding.
*/

import { existsSync, readdirSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import surfaces from '@/data/gameData/portraitSurfaces.json'
import { readPortraitSurface } from '../portraitSurface.ts'

afterEach(() => vi.unstubAllGlobals())

describe('bundled portrait surface assets', () => {
  it('looks up setup colors without a browser image decoder', async () => {
    vi.stubGlobal('window', { location: { href: 'https://calculator.example/showcase', origin: 'https://calculator.example' } })
    vi.stubGlobal('Image', vi.fn(() => { throw new Error('Must not decode bundled art') }))
    for (const [source, color] of Object.entries(surfaces)) {
      expect(await readPortraitSurface(source)).toBe(color)
    }
    expect(await readPortraitSurface('/assets/game/resonators/spine/setup/luckdraw/new.webp'))
      .toMatch(/^#[0-9a-f]{6}$/)
    expect(Image).not.toHaveBeenCalled()
  })

  it('ships a sampled color for every bundled setup asset', () => {
    for (const directory of ['spine/setup/luckdraw', 'spine/setup/portrait', 'sprites', 'profiles']) {
      const path = `/assets/game/resonators/${directory}`
      if (!existsSync(`public${path}`)) continue
      const files = readdirSync(`public${path}`, { withFileTypes: true })
      for (const file of files.filter((entry) => entry.isFile() && /\.(webp|png|jpe?g)$/i.test(entry.name))) {
        expect((surfaces as Record<string, string>)[`${path}/${file.name}`]).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })
})
