/*
  Author: Runor Ewhro
  description: identifies Lily's HP finishers whose crit bonuses must be
               recomputed from each search candidate's Energy Regen.
*/

export function isLilyErCritSkill(characterId: number, skillId: string): boolean {
  return characterId === 1512 && ['1512015', '1512016', '1512023'].includes(skillId)
}

export function lilyExcessEr(finalEr: number): number {
  return Math.min(Math.max(0, finalEr - 100), 160)
}
