/*
  Author: Runor Ewhro
  description: selects bounded live spine texture resolutions and maps canonical
               texture pages to their generated display derivatives.
*/

export const SPINE_TEXTURE_MAX_EDGE = 2048
const RESOLUTIONS = [768, 1024, 1280, 1536] as const

export function chooseSpineResolution(cssSize: number): number {
  const target = Math.max(RESOLUTIONS[0], cssSize)
  return RESOLUTIONS.find((size) => size >= target) ?? RESOLUTIONS[RESOLUTIONS.length - 1]
}

export function spineDisplayTextureUrl(baseUrl: string, pageName: string): string {
  return `${baseUrl}display/${pageName}`
}
