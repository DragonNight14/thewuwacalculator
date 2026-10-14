/*
  Author: Runor Ewhro
  description: provides shared game asset helpers and state updates.
*/

import type { CSSProperties } from 'react'

const RES_SKILL_ROOT = '/assets/game/resonators/skills'

/** how many resonance chain nodes the game gives a resonator */
export const SEQ_NODES = 6

/*
  the skill nodes `npm run ingest:node-icons` writes. these white game glyphs
  use masks that take the surface colour and remain visible in light themes.
*/
export const RES_NODE_KEYS = [
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
  'outroSkill',
  'inherent1',
  'inherent2',
  'tuneBreak',
] as const

export type ResNodeKey = (typeof RES_NODE_KEYS)[number]

/** the glyph for one of a resonator's skills */
export function resNodeIcon(resonatorId: string, node: ResNodeKey): string {
  return `${RES_SKILL_ROOT}/${resonatorId}/nodes/${node}.webp`
}

/** the glyph for one resonance chain node, counted from 1 */
export function resSeqIcon(resonatorId: string, node: number): string {
  return `${RES_SKILL_ROOT}/${resonatorId}/sequence/${node}.webp`
}

/** all six chain glyphs in the order the game hangs them */
export function resSeqIcons(resonatorId: string): string[] {
  return Array.from({ length: SEQ_NODES }, (_, index) => resSeqIcon(resonatorId, index + 1))
}

/*
  inherent skill art is named by unlock order. levels vary by resonator.
*/
export function resInherentIcon(resonatorId: string, order: number): string | null {
  const node = RES_NODE_KEYS.find((key) => key === `inherent${order + 1}`)
  return node ? resNodeIcon(resonatorId, node) : null
}

/*
  mask urls require quotes for paths the browser could read as a keyword.
  this helper writes the quoted url into the custom property.
*/
export function glyphVars(url: string | null, property = '--glyph'): CSSProperties | undefined {
  return url ? ({ [property]: `url("${url}")` } as CSSProperties) : undefined
}
