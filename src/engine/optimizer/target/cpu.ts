/*
  Author: Runor Ewhro
  description: scores a target optimizer combination for each valid main Echo.
*/

import type { CpuScratch } from '@/engine/optimizer/cpu/scratch.ts'
import { applySetVec } from '@/engine/search/encode/sets.ts'
import {
  MAIN_FIRST,
  WEAPON_OVERLAY_SLOTS,
  WEAPON_OVERLAY_STRIDE,
  ECHO_STAT_STRIDE,
  SET_SLOT_COUNT,
} from '@/engine/search/layout/constants.ts'
import { countOneBits } from '@/engine/search/score/specialMath.ts'
import { mkTgtComboTerms, tgtComboTerms, tgtCtx, tgtMainDamage, type SetBonus } from '@/engine/search/score/core.ts'

const terms = mkTgtComboTerms()

// build the raw combo stat vector and per-set unique-kind counts for one 5-echo
// combo. depends only on the combo, so a caller evaluating one combo against
// many contexts/weapons can build it once and pass it to evalTgtCpuCmPrepped.
export function mkCmbBaseStt(
    scratch: CpuScratch,
    stats: Float32Array,
    sets: Uint8Array,
    kinds: Uint16Array,
    comboIds: Int32Array,
): number {
  const base = scratch.baseCmbVctr
  base.fill(0)

  const setCounts = scratch.setCounts
  const setMasks = scratch.setMasks
  const tchdSetIds = scratch.tchdSetIds
  let tchdSetCnt = 0

  for (let comboIndex = 0; comboIndex < comboIds.length; comboIndex += 1) {
    const echoIndex = comboIds[comboIndex]
    const statsBase = echoIndex * ECHO_STAT_STRIDE

    // add the current echo's packed stat row into the combo base vector
    for (let offset = 0; offset < ECHO_STAT_STRIDE; offset += 1) {
      base[offset] += stats[statsBase + offset]
    }

    const setId = sets[echoIndex]
    if (setId < 0 || setId >= SET_SLOT_COUNT) {
      continue
    }

    // kind ids deduplicate identical echoes in set-piece counts.
    const bit = (1 << (kinds[echoIndex] & 31)) >>> 0
    const prevMask = setMasks[setId] >>> 0
    const nextMask = (prevMask | bit) >>> 0
    if (nextMask === prevMask) {
      continue
    }

    if (prevMask === 0) {
      tchdSetIds[tchdSetCnt] = setId
      tchdSetCnt += 1
    }

    setMasks[setId] = nextMask
  }

  // finalize piece counts only for sets touched by this combo
  for (let index = 0; index < tchdSetCnt; index += 1) {
    const setId = tchdSetIds[index]
    setCounts[setId] = countOneBits(setMasks[setId])
  }

  return tchdSetCnt
}

// clear touched set slots for scratch buffer reuse.
// exported alongside mkCmbBaseStt so callers that aggregate once can also clear once.
export function clrCmbSetStt(scratch: CpuScratch, tchdSetCnt: number): void {
  for (let index = 0; index < tchdSetCnt; index += 1) {
    const setId = scratch.tchdSetIds[index]
    scratch.setCounts[setId] = 0
    scratch.setMasks[setId] = 0
  }
}

// add a set lut row (field order of encode/sets.ts) onto a set bonus
function addSetBonus(bonus: SetBonus, row: Float32Array): SetBonus {
  return {
    atkP: bonus.atkP + row[0]!, atkF: bonus.atkF + row[1]!, hpP: bonus.hpP + row[2]!, hpF: bonus.hpF + row[3]!,
    defP: bonus.defP + row[4]!, defF: bonus.defF + row[5]!, critRate: bonus.critRate + row[6]!, critDmg: bonus.critDmg + row[7]!,
    er: bonus.er + row[8]!, basic: bonus.basic + row[9]!, heavy: bonus.heavy + row[10]!, skill: bonus.skill + row[11]!,
    lib: bonus.lib + row[12]!, aero: bonus.aero + row[13]!, spectro: bonus.spectro + row[14]!, fusion: bonus.fusion + row[15]!,
    glacio: bonus.glacio + row[16]!, havoc: bonus.havoc + row[17]!, electro: bonus.electro + row[18]!,
    echoSkill: bonus.echoSkill + row[19]!, coord: bonus.coord + row[20]!, bonusBase: bonus.bonusBase + row[21]!,
    erSetBonus: bonus.erSetBonus + row[22]!,
  }
}

// evaluate one combo against one context. the combo's echo-stat aggregate
// (scratch.baseCmbVctr + scratch.setCounts) must already be built by mkCmbBaseStt;
// the same aggregate serves every context and weapon for that combo.
export function evalTgtCpuCmPrepped(options: {
  context: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
  constraints: Float32Array
  comboIds: Int32Array
  lockMainIdx: number
  scratch: CpuScratch
  /** one combo may reuse set arithmetic across rotation contexts and mains. */
  setBonusCache?: Map<string, SetBonus>
  /** added to the set bonus in set lut field order (search bounds only). */
  setBonusExtra?: Float32Array
}): { damage: number; mainIndex: number } | null {
  const { comboIds, lockMainIdx, scratch, mainEchoBuffs, constraints } = options
  const ctx = tgtCtx(options.context)
  const setCounts = scratch.setCounts

  // apply encoded set bonuses once for the full combo before trying each main slot
  let setBonus = options.setBonusCache?.get(ctx.setGroupKey)
  if (!setBonus) {
    setBonus = applySetVec(setCounts, ctx.skillMask, options.setConstLut, ctx.setRtMask)
    options.setBonusCache?.set(ctx.setGroupKey, setBonus)
  }
  if (options.setBonusExtra) {
    setBonus = addSetBonus(setBonus, options.setBonusExtra)
  }
  tgtComboTerms(ctx, scratch.baseCmbVctr, setBonus, terms)

  let bestDamage = 0
  let bestMainIndex = -1
  const firstSlotMain = lockMainIdx === MAIN_FIRST
  const fixedMain = firstSlotMain || lockMainIdx >= 0

  // try every combo member as the main echo unless one is explicitly locked
  for (let index = 0; index < comboIds.length; index += 1) {
    const mainIndex = firstSlotMain ? comboIds[0] : lockMainIdx >= 0 ? lockMainIdx : comboIds[index]
    // a failed limit (LIMIT_FAILED) never beats the best
    const avg = tgtMainDamage(ctx, terms, setCounts, mainEchoBuffs, mainIndex, constraints)
    if (avg > bestDamage) {
      bestDamage = avg
      bestMainIndex = mainIndex
    }
    // when the main is locked there is only one candidate to test
    if (fixedMain) break
  }

  return bestMainIndex >= 0 ? { damage: bestDamage, mainIndex: bestMainIndex } : null
}

// evaluate one combo against one context, aggregating the combo's echo stats
// first. single-shot entry point for evaluating one combo in isolation.
export function evalTgtCpuCm(options: {
  context: Float32Array
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
  sets: Uint8Array
  kinds: Uint16Array
  constraints: Float32Array
  comboIds: Int32Array
  lockMainIdx: number
  scratch: CpuScratch
}): { damage: number; mainIndex: number } | null {
  const tchdSetCnt = mkCmbBaseStt(
      options.scratch,
      options.stats,
      options.sets,
      options.kinds,
      options.comboIds,
  )
  const result = evalTgtCpuCmPrepped(options)
  clrCmbSetStt(options.scratch, tchdSetCnt)
  return result
}

// compose w full packed contexts from a shared base context and the per-weapon
// stat overlays. only WEAPON_OVERLAY_SLOTS differ per weapon; everything else
// (set mask, scaling, enemy, archetype, meta) is weapon-invariant and copied
// from base. built once per run, then reused across every combo.
export function composeWeaponContexts(
    base: Float32Array,
    overlays: Float32Array,
    count: number,
): Float32Array[] {
  const out: Float32Array[] = []
  for (let w = 0; w < count; w += 1) {
    out.push(composeOneWeaponContext(base, overlays, w))
  }
  return out
}

// the base context with just one weapon's overlay applied, used to recompute a
// single result's display stats against the weapon the search chose for it.
export function composeOneWeaponContext(
    base: Float32Array,
    overlays: Float32Array,
    weaponIndex: number,
): Float32Array {
  const ctx = base.slice()
  const overlayBase = weaponIndex * WEAPON_OVERLAY_STRIDE
  for (let s = 0; s < WEAPON_OVERLAY_STRIDE; s += 1) {
    ctx[WEAPON_OVERLAY_SLOTS[s]!] = overlays[overlayBase + s]!
  }
  return ctx
}

// evaluate one combo against every weapon context and keep the best, returning
// the winning weapon index alongside damage + main echo. the cpu reference for
// the gpu max-over-weapons reduction.
export function evalTgtCpuCmWeapons(options: {
  weaponContexts: Float32Array[]
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
  sets: Uint8Array
  kinds: Uint16Array
  constraints: Float32Array
  comboIds: Int32Array
  lockMainIdx: number
  scratch: CpuScratch
}): { damage: number; mainIndex: number; weaponIndex: number } | null {
  const { weaponContexts, ...rest } = options

  let bestDamage = 0
  let bestMainIndex = -1
  let bestWeapon = -1

  for (let w = 0; w < weaponContexts.length; w += 1) {
    const evaluated = evalTgtCpuCm({ context: weaponContexts[w]!, ...rest })
    if (evaluated && evaluated.damage > bestDamage) {
      bestDamage = evaluated.damage
      bestMainIndex = evaluated.mainIndex
      bestWeapon = w
    }
  }

  return bestWeapon >= 0
      ? { damage: bestDamage, mainIndex: bestMainIndex, weaponIndex: bestWeapon }
      : null
}
