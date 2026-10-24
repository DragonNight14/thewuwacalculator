/*
  Author: Runor Ewhro
  description: defines canonical field order and offsets for encoded Echo stats
               and main-Echo effect rows.
*/
export const ECHO_STAT_KEYS = ['atkPercent', 'atkFlat', 'hpPercent', 'hpFlat', 'defPercent', 'defFlat', 'critRate', 'critDmg', 'energyRegen', 'healingBonus', 'basicAtk', 'heavyAtk', 'resonanceSkill', 'resonanceLiberation', 'aero', 'spectro', 'fusion', 'glacio', 'havoc', 'electro'] as const
export const MAIN_BUFF_KEYS = ['atkPercent', 'atkFlat', 'basicAtk', 'heavyAtk', 'resonanceSkill', 'resonanceLiberation', 'aero', 'glacio', 'fusion', 'spectro', 'havoc', 'electro', 'energyRegen', 'echoSkill', 'coord', 'critRate', 'critDmg', 'dmgBonus'] as const

function offsets<const T extends readonly string[]>(keys: T): Readonly<Record<T[number], number>> {
  return Object.freeze(Object.fromEntries(keys.map((key, index) => [key, index]))) as Record<T[number], number>
}
export const ECHO_STAT = offsets(ECHO_STAT_KEYS)
export const MAIN_BUFF = offsets(MAIN_BUFF_KEYS)
export const ECHO_STAT_STRIDE = ECHO_STAT_KEYS.length
export const MAIN_BUFF_LEN = MAIN_BUFF_KEYS.length
