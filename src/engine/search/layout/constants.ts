/*
  Author: Runor Ewhro
  description: defines the packed search format shared by payload builders,
               CPU scorers, and WGSL kernels; changes here alter their binary
               contract.
*/

export const MAX_ECHO_COST = 12

// structural packing sizes
export const ECHOES_PER_SET = 5
// cpu and gpu count arrays index directly by set id; capacity is max id + 1.
// keep it synchronized with setcnstlutse and the shaders' SET_SLOTS.
export const SET_SLOT_COUNT = 39
export const CTX_FLOATS = 36
// ECHO_STAT_STRIDE is the live search encoding (search/encode/echoes.ts and the
// target/rotation cpu evaluators + gpu shaders read it): echo-rollable stats
// plus the per-element and per-skill-type damage-bonus buckets.
//
// FULL_STAT_STRIDE retains the existing CPU scratch-buffer capacity.
export { ECHO_STAT_STRIDE, MAIN_BUFF_LEN } from './echoLayout'
export const FULL_STAT_STRIDE = 30
export const MAIN_FIRST = -2

// numeric archetype codes used by packed contexts and shader / evaluator logic
export const ARCH_DAMAGE = 0
export const ARCH_HEAL = 1
export const ARCH_SHIELD = 2
export const ARCH_TUNE = 3
export const ARCH_SPECTRO = 4
export const ARCH_AERO = 5
export const ARCH_FUSION = 6
export const ARCH_ELECTRO = 7
export const ARCH_GLACIO = 8
export const ARCH_HACK = 9

// packed optimizer context offsets
// these constants define the meaning of each float slot in the packed context array
export const BASE_ATK = 0
export const BASE_HP = 1
export const BASE_DEF = 2
export const BASE_ER = 3
export const FINAL_ATK = 4
export const FINAL_HP = 5
export const FINAL_DEF = 6
export const SCALING_ATK = 8
export const SCALING_HP = 9
export const SCALING_DEF = 10
export const SCALING_ER = 11
export const MV = 12
export const FLAT_DMG = 13
export const RES_MUL = 14
export const DEF_MUL = 15
export const DMG_RED = 16
export const DMG_BNS = 17
export const DMG_AMP = 18
export const DMG_VULN = 19
export const CRIT_RATE = 20
export const CRIT_DMG = 21
export const TOGGLES = 22
export const SKILL_ID = 23
export const META0 = 24
export const META1 = 25
export const LOCKED_PACKED = 26
export const BASE_INDEX = 27
export const SET_MASK = 28
export const WORKGROUP_BASE = 29
export const COMBO_N = 30
export const AUX0 = 31
export const ARCHETYPE = 32
export const CANDIDATE_FLOOR = 33

export const WEAPON_OVERLAY_SLOTS = [
  BASE_ATK,
  FINAL_ATK,
  FINAL_HP,
  FINAL_DEF,
  BASE_ER,
  CRIT_RATE,
  CRIT_DMG,
  DMG_BNS,
  DMG_AMP,
  MV,
  FLAT_DMG,
  AUX0,
  RES_MUL,
  DEF_MUL,
  DMG_RED,
  DMG_VULN,
] as const
export const WEAPON_OVERLAY_STRIDE = WEAPON_OVERLAY_SLOTS.length

// packed candidate rank encodes the chosen weapon in the high bits when weapon
// search is active (theory batch mode pins the main echo at slot 0, freeing the
// main-position bits). 5 bits -> up to 31 weapon candidates.
export const WEAPON_INDEX_SHIFT = 27
export const WEAPON_INDEX_BITS = 5
export const MAX_WEAPON_CANDIDATES = (1 << WEAPON_INDEX_BITS) - 1

// decode masks for the packed candidate rank when weapon search is active:
// the low bits hold the combo rank, the high bits the chosen weapon index.
export const WEAPON_RANK_MASK = (1 << WEAPON_INDEX_SHIFT) - 1
export const WEAPON_BIT_MASK = (1 << WEAPON_INDEX_BITS) - 1

// generated full-rotation kernels retain one candidate for every combination,
// including every cycle in an invocation. host dispatch sizes use these same
// values; shader templates are specialized from them before compilation.
export const NATIVE_ROTATION_WORKGROUP_SIZE = 128
export const NATIVE_ROTATION_CYCLES = 4
// how deep the generated rotation kernels may branch
export const SHADER_BRANCH_DEPTH = 24
