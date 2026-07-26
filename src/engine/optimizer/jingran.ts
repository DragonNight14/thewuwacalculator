/*
  Author: Runor Ewhro
  Description: shared Jingran-specific packed optimizer helpers.
*/

export const JINGRAN_FORTUNE_SHIFT = 3
export const JINGRAN_FORTUNE_MASK = 0x3f
export const JINGRAN_EVERFLOW_BIT = 1 << 9
export const JINGRAN_FIRE_OF_LIFE_BIT = 1 << 10
export const JINGRAN_LIB_LEVEL_SHIFT = 11
export const JINGRAN_LIB_LEVEL_MASK = 0x1f

export const JINGRAN_SOUL_RAID_SKILL_HASH = 8817
export const JINGRAN_STARDOME_SKILL_HASH = 3177

const SOUL_RAID_FIRE_OF_LIFE_VALUES = [
  0.0796,
  0.086,
  0.0923,
  0.1016,
  0.1079,
  0.1154,
  0.126,
  0.1364,
  0.1466,
  0.1577,
  0.1708,
  0.1839,
  0.1966,
  0.2097,
  0.2227,
  0.2355,
  0.2486,
  0.2616,
  0.2746,
  0.2877,
]

const STARDOME_FIRE_OF_LIFE_VALUES = [
  0.0815,
  0.088,
  0.0948,
  0.104,
  0.1108,
  0.1185,
  0.129,
  0.1398,
  0.1505,
  0.1618,
  0.175,
  0.1885,
  0.2018,
  0.2149,
  0.2284,
  0.2416,
  0.2549,
  0.2684,
  0.2816,
  0.2949,
]

export function packJingranLibLevel(level: number | null | undefined): number {
  const clamped = Math.max(1, Math.min(20, Math.trunc(Number(level) || 1)))
  return (clamped & JINGRAN_LIB_LEVEL_MASK) << JINGRAN_LIB_LEVEL_SHIFT
}

export function getJingranFortune(toggles: number): number {
  return (toggles >>> JINGRAN_FORTUNE_SHIFT) & JINGRAN_FORTUNE_MASK
}

export function hasJingranEverflow(toggles: number): boolean {
  return (toggles & JINGRAN_EVERFLOW_BIT) !== 0
}

export function getJingranSkillHash(skillId: number): number {
  return (skillId >>> 18) & 0x3fff
}

function getJingranLibLevel(toggles: number): number {
  const encoded = (toggles >>> JINGRAN_LIB_LEVEL_SHIFT) & JINGRAN_LIB_LEVEL_MASK
  return Math.max(1, Math.min(20, encoded || 1))
}

function getFireOfLifeRate(skillHash: number, level: number): number {
  const index = Math.max(0, Math.min(19, level - 1))
  if (skillHash === JINGRAN_SOUL_RAID_SKILL_HASH) {
    return SOUL_RAID_FIRE_OF_LIFE_VALUES[index]
  }
  if (skillHash === JINGRAN_STARDOME_SKILL_HASH) {
    return STARDOME_FIRE_OF_LIFE_VALUES[index]
  }
  return 0
}

export function calcJingranFireOfLifeMultiplier(
    characterId: number,
    skillId: number,
    finalHp: number,
    toggles: number,
): number {
  if (characterId !== 1212 || (toggles & JINGRAN_FIRE_OF_LIFE_BIT) === 0) {
    return 0
  }

  const rate = getFireOfLifeRate(getJingranSkillHash(skillId), getJingranLibLevel(toggles))
  if (rate <= 0) {
    return 0
  }

  return Math.min(Math.max(0, finalHp), 35000) * 0.001 * rate
}
