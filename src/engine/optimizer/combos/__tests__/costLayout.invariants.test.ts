/*
  Author: Runor Ewhro
  description: verifies cost-layout ranking enumerates every legal Echo
               combination exactly once, with and without a locked main Echo.
*/

import { describe, expect, it } from 'vitest'
import { mkCostLayout, nrnkCostCombo } from '@/engine/optimizer/combos/costLayout'
import { mkCmbnTbl } from '@/engine/optimizer/combos/combinadic'

// brute-force reference for the cost layout: every legal combo exactly once, in
// the advance order the shader walks.
function advance(combo: number[], layout: ReturnType<typeof mkCostLayout>, seg: { s: number }): boolean {
  const k = layout.comboK
  const groupOf = (pos: number) => { let acc = 0; const c = layout.segCounts[seg.s]!; for (let g = 0; g < c.length; g++) { acc += c[g]!; if (pos < acc) return g } return -1 }
  const posMax = (pos: number) => { const g = groupOf(pos); const c = layout.segCounts[seg.s]!; const before = c.slice(0, g).reduce((a, b) => a + b, 0); return layout.groupStart[g]! + layout.groupSize[g]! - c[g]! + (pos - before) }
  for (let i = k - 1; i >= 0; i--) {
    if (combo[i]! < posMax(i)) {
      combo[i]! += 1
      for (let t = i + 1; t < k; t++) combo[t] = groupOf(t) === groupOf(t - 1) ? combo[t - 1]! + 1 : layout.groupStart[groupOf(t)]!
      return true
    }
  }
  return false
}

describe('cost layout', () => {
  for (const [label, lockedIndex] of [['unlocked', -1], ['locked', 3]] as const) {
    it(`enumerates each legal combo once in rank order (${label})`, () => {
      const costs = Array.from({ length: 23 }, (_, i) => [4, 3, 1, 1, 3, 4, 1][i % 7]!)
      const comboK = lockedIndex >= 0 ? 4 : 5
      const binom = mkCmbnTbl(lockedIndex >= 0 ? costs.length - 1 : costs.length, 5)
      const layout = mkCostLayout(costs, comboK, lockedIndex, 12, binom)
      const seen = new Set<string>()
      const out = new Int32Array(5)
      let legal = 0
      const pool = costs.map((_, i) => i).filter((i) => i !== lockedIndex)
      const rec = (start: number, picked: number[]) => {
        if (picked.length === comboK) {
          const cost = picked.reduce((a, i) => a + costs[i]!, 0) + (lockedIndex >= 0 ? costs[lockedIndex]! : 0)
          if (cost <= 12) legal++
          return
        }
        for (let p = start; p < pool.length; p++) rec(p + 1, [...picked, pool[p]!])
      }
      rec(0, [])
      expect(layout.total).toBe(legal)
      // walk with the shader-style advance from rank 0 and compare against unranking
      for (let s = 0; s < layout.segStart.length; s++) {
        nrnkCostCombo(layout.segStart[s]!, layout, binom, out)
        const posOf = new Map(Array.from(layout.indexMap).map((e, p) => [e, p]))
        const combo = Array.from(out.slice(0, comboK)).map((e) => posOf.get(e)!)
        const seg = { s }
        for (let r = layout.segStart[s]!; r < layout.segStart[s]! + layout.segSize[s]!; r++) {
          nrnkCostCombo(r, layout, binom, out)
          const ids = Array.from(out.slice(0, comboK))
          expect(ids).toEqual(combo.map((p) => layout.indexMap[p]))
          const key = [...ids].sort((a, b) => a - b).join(',')
          expect(seen.has(key)).toBe(false)
          seen.add(key)
          const cost = ids.reduce((a, i) => a + costs[i]!, 0) + (lockedIndex >= 0 ? costs[lockedIndex]! : 0)
          expect(cost).toBeLessThanOrEqual(12)
          if (lockedIndex >= 0) expect(out[4]).toBe(lockedIndex)
          const more = advance(combo, layout, seg)
          if (r + 1 < layout.segStart[s]! + layout.segSize[s]!) expect(more).toBe(true)
          else expect(more).toBe(false)
        }
      }
      expect(seen.size).toBe(legal)
    })
  }
})
