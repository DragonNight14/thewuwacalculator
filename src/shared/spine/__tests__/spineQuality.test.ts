/*
  Author: Runor Ewhro
  description: verifies live spine assets use bounded display derivatives while
               export paths retain full-resolution setup images.
*/

import { describe, expect, it } from 'vitest'
import { chooseSpineResolution, SPINE_TEXTURE_MAX_EDGE, spineDisplayTextureUrl } from '../spineQuality.ts'
import { spineBaseUrl, spineSetupUrl } from '../spineManifest.ts'

describe('Spine display and export asset contracts', () => {
  it.each(['portrait', 'luckdraw'] as const)('separates %s display and export images', (variant) => {
    expect(spineSetupUrl('1506', variant)).toBe(`/assets/game/resonators/spine/setup/display/${variant}/1506.webp`)
    expect(spineSetupUrl('1506', variant, 'export')).toBe(`/assets/game/resonators/spine/setup/${variant}/1506.webp`)
    expect(spineDisplayTextureUrl(spineBaseUrl('1506', variant), 'texture-1.webp'))
      .toBe(`/assets/game/resonators/spine/${variant}/1506/display/texture-1.webp`)
  })

  it('keeps large and zoomed live portraits within the display GPU budget', () => {
    expect(chooseSpineResolution(0)).toBe(768)
    expect(chooseSpineResolution(1000)).toBe(1024)
    expect(chooseSpineResolution(1100)).toBe(1280)
    expect(chooseSpineResolution(8000)).toBe(1536)
    expect(SPINE_TEXTURE_MAX_EDGE).toBe(2048)
  })
})
