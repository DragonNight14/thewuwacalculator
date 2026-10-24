/*
  Author: Runor Ewhro
  description: builds conservative cost-suffix tables used to prune target-GPU
               tiles without excluding a possible winning combination.
*/

import { ECHO_STAT_STRIDE, MAIN_BUFF_LEN } from '@/engine/search/layout/echoLayout.ts'
import type { CostLayout } from '@/engine/optimizer/combos/costLayout.ts'

// must match the shader's BOUND_* constants and set lut layout
const SET_LUT_BUCKETS = 5
const SET_LUT_STRIDE = 23
export const SET_ROW_FLOATS = 24
const MAX_FREE = 5
const SET_HEAD_FLOATS = 36 * 4
const MAIN_FLOATS = Math.ceil(MAIN_BUFF_LEN / 4) * 4
const POS_FLOATS = ECHO_STAT_STRIDE + MAIN_FLOATS

// piece count -> lut bucket, as applySetEffectsBase reads it
function bucketOf(count: number): number {
  return Number(count >= 1) + Number(count >= 2) + Number(count >= 3) + Number(count >= 5)
}

// per free-slot count, the field-wise best bonus of any split of those slots
// into sets the fixed echoes do not hold. rows are SET_ROW_FLOATS apart.
export function newSetRows(setConstLut: Float32Array): Float32Array {
  const sets = Math.floor(setConstLut.length / (SET_LUT_BUCKETS * SET_LUT_STRIDE))
  const best = new Float32Array(SET_LUT_BUCKETS * SET_LUT_STRIDE)
  for (let set = 0; set < sets; set += 1) {
    for (let index = 0; index < SET_LUT_BUCKETS * SET_LUT_STRIDE; index += 1) {
      best[index] = Math.max(best[index]!, setConstLut[set * SET_LUT_BUCKETS * SET_LUT_STRIDE + index]!)
    }
  }

  const rows = new Float32Array((MAX_FREE + 1) * SET_ROW_FLOATS)
  for (let free = 1; free <= MAX_FREE; free += 1) {
    for (let field = 0; field < SET_LUT_STRIDE; field += 1) {
      let value = 0
      for (let part = 1; part <= free; part += 1) {
        value = Math.max(value,
          best[bucketOf(part) * SET_LUT_STRIDE + field]! + rows[(free - part) * SET_ROW_FLOATS + field]!)
      }
      rows[free * SET_ROW_FLOATS + field] = value
    }
  }
  return rows
}

export function mkBoundData(
    layout: CostLayout,
    stats: Float32Array,
    mainEchoBuffs: Float32Array,
    setConstLut: Float32Array,
): Float32Array {
  const out = new Float32Array(SET_HEAD_FLOATS + layout.indexMap.length * POS_FLOATS)
  out.set(newSetRows(setConstLut))

  // walk each cost group backward to store the suffix maximum at every slot.
  for (let group = 0; group < layout.groupSize.length; group += 1) {
    const start = layout.groupStart[group]!
    for (let pos = start + layout.groupSize[group]! - 1; pos >= start; pos -= 1) {
      const echo = layout.indexMap[pos]!
      const at = SET_HEAD_FLOATS + pos * POS_FLOATS
      const next = pos + 1 < start + layout.groupSize[group]! ? at + POS_FLOATS : -1
      for (let field = 0; field < ECHO_STAT_STRIDE; field += 1) {
        const value = stats[echo * ECHO_STAT_STRIDE + field]!
        out[at + field] = next < 0 ? value : Math.max(value, out[next + field]!)
      }
      for (let field = 0; field < MAIN_BUFF_LEN; field += 1) {
        const value = mainEchoBuffs[echo * MAIN_BUFF_LEN + field]!
        const slot = at + ECHO_STAT_STRIDE + field
        out[slot] = next < 0 ? value : Math.max(value, out[next + ECHO_STAT_STRIDE + field]!)
      }
    }
  }
  return out
}
