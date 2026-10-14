/*
  Author: Runor Ewhro
  description: uses responsive game art while retaining the canonical source
               for capture and falling back when a derivative is unavailable.
*/
import { useLayoutEffect, useRef, type ImgHTMLAttributes } from 'react'
import { resolveDisplayImage } from '@/shared/lib/displayAssets'
import { observeDisplayImage } from '@/shared/lib/displayImageSizing'

export function DisplayImage({ src, onError, 'data-capture-src': captureSrc, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'sizes' | 'srcSet'> & { 'data-capture-src'?: string }) {
  const imageRef = useRef<HTMLImageElement>(null)
  const asset = resolveDisplayImage(src ?? '')
  const generated = Boolean(asset.srcSet)
  useLayoutEffect(() => {
    if (!generated || !src || !imageRef.current) return
    return observeDisplayImage(imageRef.current, src)
  }, [generated, src])
  return <img ref={imageRef} decoding="async" width={asset.width} height={asset.height} {...props}
    src={generated ? undefined : src}
    data-capture-src={captureSrc ?? (asset.srcSet ? src : undefined)}
    onError={(event) => {
      const image = event.currentTarget
      if (generated && image.getAttribute('src') !== src) {
        image.removeAttribute('srcset')
        image.removeAttribute('sizes')
        image.src = src!
        return
      }
      onError?.(event)
    }} />
}
