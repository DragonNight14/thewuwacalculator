/*
  Author: Runor Ewhro
  description: verifies target-GPU bound tables conservatively cover every
               remaining Echo and set contribution for each cost-layout suffix.
*/

import { describe, expect, it } from 'vitest'
import { mkCostLayout } from '@/engine/optimizer/combos/costLayout'
import { mkCmbnTbl } from '@/engine/optimizer/combos/combinadic'
import { ECHO_STAT_STRIDE, MAIN_BUFF_LEN } from '@/engine/search/layout/echoLayout'
import { mkBoundData } from '@/engine/optimizer/gpu/targetBound'

// mirrors the shader's table layout (see target.wgsl BOUND_*)
const SET_HEAD = 36 * 4
const MAIN_FLOATS = Math.ceil(MAIN_BUFF_LEN / 4) * 4
const POS = ECHO_STAT_STRIDE + MAIN_FLOATS
const LUT_STRIDE = 23
const BUCKETS = 5
const bucketOf = (count: number) => Number(count >= 1) + Number(count >= 2) + Number(count >= 3) + Number(count >= 5)

function rng(seed: number) {
  return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
}

describe('target tile bound tables', () => {
  const rand = rng(5)
  const costs = Array.from({ length: 19 }, (_, i) => [4, 3, 1, 1, 3][i % 5]!)
  const stats = Float32Array.from({ length: costs.length * ECHO_STAT_STRIDE }, () => Math.round(rand() * 20))
  const mains = Float32Array.from({ length: costs.length * MAIN_BUFF_LEN }, () => Math.round(rand() * 10))
  const sets = 6
  const lut = Float32Array.from({ length: sets * BUCKETS * LUT_STRIDE }, () => Math.round(rand() * 15))

  for (const lockedIndex of [-1, 2]) {
    it(`stores each cost group's per-field suffix maximum (lock ${lockedIndex})`, () => {
      const layout = mkCostLayout(costs, lockedIndex >= 0 ? 4 : 5, lockedIndex, 12, mkCmbnTbl(costs.length, 5))
      const table = mkBoundData(layout, stats, mains, lut)
      expect(table.length).toBe(SET_HEAD + layout.indexMap.length * POS)
      layout.groupSize.forEach((size, group) => {
        const start = layout.groupStart[group]!
        for (let pos = start; pos < start + size; pos += 1) {
          const rest = Array.from(layout.indexMap.slice(pos, start + size))
          for (let field = 0; field < ECHO_STAT_STRIDE; field += 1) {
            expect(table[SET_HEAD + pos * POS + field]).toBe(Math.max(...rest.map((echo) => stats[echo * ECHO_STAT_STRIDE + field]!)))
          }
          for (let field = 0; field < MAIN_BUFF_LEN; field += 1) {
            expect(table[SET_HEAD + pos * POS + ECHO_STAT_STRIDE + field]).toBe(Math.max(...rest.map((echo) => mains[echo * MAIN_BUFF_LEN + field]!)))
          }
        }
      })
    })
  }

  it('bounds every way free slots can open sets', () => {
    const layout = mkCostLayout(costs, 5, -1, 12, mkCmbnTbl(costs.length, 5))
    const table = mkBoundData(layout, stats, mains, lut)
    // every split of the free slots into distinct sets, summed per field
    const splits = (free: number, minSet: number): number[][] => {
      if (free === 0) return [new Array<number>(LUT_STRIDE).fill(0)]
      const out: number[][] = []
      for (let set = minSet; set < sets; set += 1) {
        for (let take = 1; take <= free; take += 1) {
          const row = lut.subarray((set * BUCKETS + bucketOf(take)) * LUT_STRIDE)
          for (const rest of splits(free - take, set + 1)) out.push(rest.map((value, field) => value + row[field]!))
        }
      }
      return out
    }
    for (let free = 0; free <= 5; free += 1) {
      const bound = table.subarray(free * 24, free * 24 + LUT_STRIDE)
      for (const split of splits(free, 0)) {
        split.forEach((value, field) => expect(bound[field]).toBeGreaterThanOrEqual(value))
      }
    }
  })
})
