/*
  Author: Runor Ewhro
  description: protects asset signatures, regeneration and source preservation.
*/
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { buildDisplayAssets } from '../buildDisplayAssets.mjs'

describe('display asset generation', () => {
  it('encodes mislabeled PNGs, preserves originals and invalidates changed content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wuwa-display-'))
    try {
      const sourceDir = join(root, 'assets/game/echoes/icons/phantom')
      await mkdir(sourceDir, { recursive: true })
      const source = join(sourceDir, 'test.webp')
      const input = await sharp({ create: { width: 80, height: 60, channels: 4, background: '#aaccff80' } }).png().toBuffer()
      await writeFile(source, input)
      const manifestPath = join(root, 'manifest.json')
      const options = { publicDir: root, manifestPath, assetGroups: [['echoes/icons', false]] }
      await buildDisplayAssets(options)
      const json = await readFile(manifestPath, 'utf8')
      const parseEntry = (text) => {
        const [fingerprint, dimensions] = JSON.parse(text)['/assets/game/echoes/icons/phantom/test.webp']
        return { variants: dimensions.map(([width, height]) => ({ src: `/assets/display/${fingerprint}-${width}.webp`, width, height })) }
      }
      const entry = parseEntry(json)
      expect(entry.variants.map((v) => v.width)).toEqual([64, 80])
      expect(await readFile(source)).toEqual(input)
      const file = join(root, entry.variants[0].src)
      expect(await sharp(file).metadata()).toMatchObject({ format: 'webp', width: 64, height: 48, hasAlpha: true })
      const written = (await stat(file)).mtimeMs
      await buildDisplayAssets(options)
      expect(await readFile(manifestPath, 'utf8')).toBe(json)
      expect((await stat(file)).mtimeMs).toBe(written)
      await rm(file)
      await buildDisplayAssets(options)
      expect(await readFile(manifestPath, 'utf8')).toBe(json)
      expect((await stat(file)).size).toBeGreaterThan(0)
      await writeFile(source, await sharp(input).negate({ alpha: false }).png().toBuffer())
      await buildDisplayAssets(options)
      const changed = parseEntry(await readFile(manifestPath, 'utf8'))
      expect(changed.variants[0].src).not.toBe(entry.variants[0].src)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
