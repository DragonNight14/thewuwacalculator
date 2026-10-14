/*
  Author: Runor Ewhro
  description: protects complete css url replacement and font-family unicode
               subset selection for standalone capture documents.
*/

import { afterEach, expect, it, vi } from 'vitest'
import { embedCaptureUrls, fontFaceUsed } from '../captureBuildCard'

afterEach(() => vi.unstubAllGlobals())

it('replaces whole relative and absolute CSS URL tokens without corrupting masks', async () => {
  vi.stubGlobal('document', { baseURI: 'https://calculator.example/showcase' })
  const result = await embedCaptureUrls(
    '--mask:url("/assets/mask.png");mask-image:url("https://calculator.example/assets/mask.png")',
    async () => 'data:image/png;base64,abcd',
  )
  expect(result).toBe('--mask:url("data:image/png;base64,abcd");mask-image:url("data:image/png;base64,abcd")')
})

it('keeps used font families and matching Unicode subsets, including supplementary characters', () => {
  const used = new Map([['card font', new Set(['normal:400'])]])
  expect(fontFaceUsed('font-family:"Card Font";unicode-range:U+0000-00FF;', used, 'Phoebe')).toBe(true)
  expect(fontFaceUsed('font-family:"Card Font";unicode-range:U+4E00-9FFF;', used, 'Phoebe')).toBe(false)
  expect(fontFaceUsed('font-family:"Card Font";unicode-range:U+1F???;', used, '🥀')).toBe(true)
  expect(fontFaceUsed('font-family:"Unused Font";', used, 'Phoebe')).toBe(false)
})
