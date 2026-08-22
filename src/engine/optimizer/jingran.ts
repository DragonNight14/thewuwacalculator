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
  0.0797,
  0.0862,
  0.0928,
  0.1019,
  0.1084,
  0.1159,
  0.1263,
  0.1367,
  0.1472,
  0.1582,
  0.1713,
  0.1844,
  0.1974,
  0.2105,
  0.2235,
  0.2365,
  0.2496,
  0.2625,
  0.2757,
  0.2888,
]

const STARDOME_FIRE_OF_LIFE_VALUES = [
  0.1089,
  0.1179,
  0.1268,
  0.1394,
  0.1484,
  0.1585,
  0.1728,
  0.187,
  0.2014,
  0.2165,
  0.2345,
  0.2524,
  0.27,
  0.2879,
  0.3058,
  0.3236,
  0.3415,
  0.3594,
  0.377,
  0.3949,
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
    sequence: number,
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

  const seqBoost = sequence >= 2 ? 1.4 : 1
  return Math.min(Math.max(0, finalHp - 25000), 25000) * 0.001 * rate * seqBoost
}
