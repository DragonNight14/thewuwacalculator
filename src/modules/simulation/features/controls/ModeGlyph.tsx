/*
  Author: Runor Ewhro
  description: resolves a resonance-mode identity to its icon or deterministic
               text fallback.
*/

import { DisplayImage } from '@/shared/ui/DisplayImage'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'

export function ModeGlyph({ icon, label }: { icon?: string; label: string }) {
  return (
    <span className="res-mode-glyph" aria-hidden="true">
      {icon
        ? <DisplayImage src={icon} alt="" onError={withDefIconM} />
        : <span>{label.trim().slice(0, 1).toUpperCase() || 'M'}</span>}
    </span>
  )
}
