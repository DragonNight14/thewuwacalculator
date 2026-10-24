/*
  Author: Runor Ewhro
  description: specializes optimizer shader templates with canonical host
               layout constants and the shared damage primitive.
*/
import { CYCLES_PER_CALL, GPU_REDUCE_K, OPT_WG_SIZE, REDUCTION_WORKGROUP_SIZE, TARGET_TILE_WORDS } from './constants'
import { NATIVE_ROTATION_CYCLES, SET_SLOT_COUNT } from '@/engine/search/layout/constants'
import { ECHO_STAT, ECHO_STAT_STRIDE, MAIN_BUFF, MAIN_BUFF_LEN } from '@/engine/search/layout/echoLayout'
import { OPTIMIZER_DAMAGE_SPEC_WGSL } from '@/engine/search/score/damageSpec.ts'

export function withOptimizerShaderConfig(source: string): string {
  const values: Record<string, number> = {
    TARGET_WORKGROUP_SIZE: OPT_WG_SIZE, TARGET_REDUCTION_STRIDE: OPT_WG_SIZE / 2,
    REDUCTION_WORKGROUP_SIZE, GPU_REDUCE_K, TARGET_CYCLES: CYCLES_PER_CALL, ROTATION_CYCLES: NATIVE_ROTATION_CYCLES,
    MAIN_BUFF_LEN, SET_SLOT_COUNT, ECHO_STAT_VEC4S: ECHO_STAT_STRIDE / 4, TARGET_TILE_WORDS,
  }
  for (const [key, index] of Object.entries(MAIN_BUFF)) values[`MAIN_BUFF_${key}`] = index
  for (const [key, index] of Object.entries(ECHO_STAT)) {
    values[`ECHO_STAT_${key}_VECTOR`] = Math.floor(index / 4)
    values[`ECHO_STAT_${key}_COMPONENT`] = index % 4
  }
  return source.replace(/__OPT_([A-Za-z0-9_]+)__/g, (_, key: string) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Unknown optimizer shader configuration ${key}`)
    return String(values[key])
  })
}

// every kernel is prefixed with the canonical damage primitive
export function withOptimizerDamageSpec(shader: string): string {
  return `${OPTIMIZER_DAMAGE_SPEC_WGSL}\n${withOptimizerShaderConfig(shader)}`
}
