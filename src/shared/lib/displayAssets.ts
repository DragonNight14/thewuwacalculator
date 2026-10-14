/*
  Author: Runor Ewhro
  description: resolves display derivatives while preserving canonical urls for
               persistence and capture. external and custom art pass through.
*/
import generated from './displayAssets.generated.json'

interface Variant { src: string; width: number; height: number }
type DisplayAsset = [fingerprint: string, dimensions: number[][]]
const assets = generated as unknown as Record<string, DisplayAsset>

export function resolveDisplayImage(source: string, displayWidth = 128, pixelRatio = 2) {
  const asset = assets[source]
  if (!asset) return { src: source }
  const [fingerprint, dimensions] = asset
  const variants: Variant[] = dimensions.map(([width, height]) => ({
    src: `/assets/display/${fingerprint}-${width}.webp`, width, height,
  }))
  if (!variants.length) return { src: source }
  const target = displayWidth * pixelRatio
  // the closest width can be slightly smaller than the target. prefer the
  // breakpoint ties select the smaller download tier.
  const selected = variants.reduce((closest, variant) =>
    Math.abs(variant.width - target) < Math.abs(closest.width - target) ? variant : closest)
  return {
    src: selected.src,
    srcSet: variants.map((variant) => `${variant.src} ${variant.width}w`).join(', '),
    width: selected.width,
    height: selected.height,
  }
}
