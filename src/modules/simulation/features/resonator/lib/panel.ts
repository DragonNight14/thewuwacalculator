/*
  Author: Runor Ewhro
  description: pure resonator-panel helpers for labels, slider display,
               control options, and image preloading.
*/

import type { ResonatorSkillTabKey as SkillTabKey} from '@/modules/simulation/features/resonator/lib/resonator.ts'

export const skllLblMap: Record<SkillTabKey, string> = {
  normalAttack: 'Normal Attack',
  resonanceSkill: 'Resonance Skill',
  forteCircuit: 'Forte Circuit',
  resonanceLiberation: 'Resonance Liberation',
  introSkill: 'Intro Skill',
  outroSkill: 'Outro Skill',
  tuneBreak: 'Tune Break',
}

// format a skill key into title-cased ui copy
export function fmtSkllKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (text) => text.toUpperCase())
}

// merge keyword lists without duplicates for description rendering
export function mrgDscrKywr(...lists: Array<string[] | undefined>): string[] {
  const merged = new Set<string>()
  for (const list of lists) {
    for (const keyword of list ?? []) {
      merged.add(keyword)
    }
  }

  return Array.from(merged)
}
