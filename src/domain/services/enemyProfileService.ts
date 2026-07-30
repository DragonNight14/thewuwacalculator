/*
  Author: Runor Ewhro
  Description: Provides helpers for reading, selecting, and mutating enemy
               profiles, including tower mode, presets, and resistances.
*/

import type { EnemyProfile, EnemyResistN, EnemyStateValue } from '@/domain/entities/appState'
import type { EnemyCatEnt, EnemyClassId, EnemyElemId, EnemyPrstDef } from '@/domain/entities/enemy'
import {
  applyTwrOfDv,
  makeEnemyProf,
  ENEMY_ELEM_ATTR,
  ENEMY_ELEM_TXT,
  getEnemyResi,
  isEnemyClssI,
  rmTwrOfDvrsR,
} from '@/domain/entities/enemy'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export interface EnemyResistR {
  elementId: EnemyElemId
  label: string
  attributeKey: string
  value: number
}

export function isCustEnemyP(profile: EnemyProfile): boolean {
  return profile.source === 'custom'
}

export function getEnemyTune(profile: EnemyProfile): number {
  return profile.status?.tuneStrain ?? 0
}

export function getRslvEnemy(profile: EnemyProfile): EnemyClassId {
  return isEnemyClssI(profile.class) ? profile.class : 1
}

export function getEnemyReys(
    profile: EnemyProfile,
    elemPtns: EnemyElemId[],
): EnemyResistR[] {
  return elemPtns.map((elementId) => ({
    elementId,
    label: ENEMY_ELEM_TXT[elementId],
    attributeKey: ENEMY_ELEM_ATTR[elementId],
    value: profile.res[elementId],
  }))
}

// Custom profiles store their own resistance table, so tower mode transforms
// those values instead of replacing them from a catalog enemy.
export function rmpCustEnemy(profile: EnemyProfile, nextToa: boolean): EnemyProfile['res'] {
  if (profile.toa === nextToa) {
    return profile.res
  }

  return nextToa
      ? applyTwrOfDv(profile.res)
      : rmTwrOfDvrsR(profile.res)
}

export function selCatEnemyP(
    curProf: EnemyProfile,
    selEnemy: EnemyCatEnt,
): EnemyProfile {
  return makeEnemyProf(selEnemy, {
    previousProfile: {
      ...curProf,
      source: 'catalog',
    },
  })
}

// Presets replace the enemy template but keep Tune Strain as encounter state
// rather than preset-authored data.
export function selEnemyPrst(profile: EnemyProfile, preset: EnemyPrstDef): EnemyProfile {
  return {
    ...preset.profile,
    toa: preset.profile.toa,
    status: {
      tuneStrain: getEnemyTune(profile),
    },
  }
}

export function tglEnemyTwrM(
    profile: EnemyProfile,
    selEnemy: EnemyCatEnt | null,
    nextToa: boolean,
): EnemyProfile {
  const nextLevel = profile.level > 0 ? profile.level : nextToa ? 100 : 90
  const customMode = isCustEnemyP(profile)

  return {
    ...profile,
    toa: nextToa,
    level: clamp(nextLevel, 1, 150),
    res: customMode
        ? rmpCustEnemy(profile, nextToa)
        : selEnemy
            ? getEnemyResi(selEnemy, nextToa)
            : profile.res,
  }
}

export function setEnemyLvl(profile: EnemyProfile, value: number): EnemyProfile {
  return {
    ...profile,
    level: clamp(Math.round(value), 1, 150),
  }
}

export function setEnemyClss(profile: EnemyProfile, enemyClass: EnemyClassId): EnemyProfile {
  return {
    ...profile,
    class: enemyClass,
  }
}

export function setEnemyResi(
    profile: EnemyProfile,
    resistNdx: EnemyResistN,
    value: number,
): EnemyProfile {
  return {
    ...profile,
    res: {
      ...profile.res,
      [resistNdx]: clamp(value, -100, 200),
    },
  }
}

function normStack(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

// Enemy status contains heterogeneous condition fields; Tune Strain is the only
// numeric stack here and must not wipe neighboring toggles/selects.
export function setEnemyTune(profile: EnemyProfile, value: number): EnemyProfile {
  return {
    ...profile,
    status: {
      ...(profile.status ?? { tuneStrain: 0 }),
      tuneStrain: normStack(value),
    },
  }
}

export function getEnemyState(
  profile: EnemyProfile,
  field: string,
): EnemyStateValue | undefined {
  return profile.status?.[field]
}

// Condition writers share the status bag with Tune Strain, so initialize the
// base field once and preserve any previously authored state values.
export function setEnemyState(
  profile: EnemyProfile,
  field: string,
  value: EnemyStateValue,
): EnemyProfile {
  return {
    ...profile,
    status: {
      tuneStrain: 0,
      ...(profile.status ?? {}),
      [field]: value,
    },
  }
}
