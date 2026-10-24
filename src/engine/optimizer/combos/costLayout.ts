/*
  Author: Runor Ewhro
  description: ranks and un-ranks cost-legal Echo combinations through the
               cost-group segments shared with the target GPU cursor.
*/

import { ECHOES_PER_SET } from '@/engine/search/layout/constants.ts'

// the shader reads the layout as array<vec4<u32>, COST_LAYOUT_VEC4S>:
// [0] = (groupCount, segmentCount, comboK, 0)
// [1] = group starts in the index map, [2] = group sizes
// [3 + s] = (segment start rank, pick counts at 4 bits per group, segment size, 0)
export const COST_LAYOUT_VEC4S = 64
export const COST_LAYOUT_MAX_GROUPS = 4
const HEADER_VEC4S = 3
const BINOM_STRIDE = ECHOES_PER_SET + 1

export interface CostLayout {
  // index-map positions grouped by cost, highest cost first
  indexMap: Int32Array
  comboK: number
  lockedIndex: number
  total: number
  groupStart: number[]
  groupSize: number[]
  segStart: number[]
  segSize: number[]
  segCounts: number[][]
  uniform: Uint32Array
}

function choose(binom: Uint32Array, n: number, k: number): number {
  return k > n ? 0 : binom[n * BINOM_STRIDE + k]!
}

export function mkCostLayout(
    costs: ArrayLike<number>,
    comboK: number,
    lockedIndex: number,
    maxCost: number,
    binom: Uint32Array,
): CostLayout {
  const budget = maxCost - (lockedIndex >= 0 ? costs[lockedIndex] ?? 0 : 0)
  const values = new Set<number>()
  for (let index = 0; index < costs.length; index += 1) {
    if (index !== lockedIndex) values.add(costs[index] ?? 0)
  }

  // more cost classes than the shader packs: one group keeps every combo and
  // the shader's own cost check stays the only filter.
  const grouped = values.size <= COST_LAYOUT_MAX_GROUPS
  const groupCosts = grouped ? [...values].sort((a, b) => b - a) : [0]
  const members: number[][] = groupCosts.map(() => [])
  for (let index = 0; index < costs.length; index += 1) {
    if (index === lockedIndex) continue
    const group = grouped ? groupCosts.indexOf(costs[index] ?? 0) : 0
    members[group]!.push(index)
  }

  const indexMap = new Int32Array(members.flat())
  const groupSize = members.map((list) => list.length)
  const groupStart = groupSize.map((_, group) => groupSize.slice(0, group).reduce((sum, size) => sum + size, 0))

  const segCounts: number[][] = []
  const segSize: number[] = []
  const counts = new Array<number>(groupCosts.length).fill(0)
  const visit = (group: number, left: number, cost: number) => {
    if (group === groupCosts.length - 1) {
      counts[group] = left
      if (grouped && cost + left * groupCosts[group]! > budget) return
      let size = 1
      for (let g = 0; g < counts.length; g += 1) size *= choose(binom, groupSize[g]!, counts[g]!)
      if (size > 0) {
        segCounts.push([...counts])
        segSize.push(size)
      }
      return
    }
    for (let take = left; take >= 0; take -= 1) {
      counts[group] = take
      visit(group + 1, left - take, cost + take * groupCosts[group]!)
    }
  }
  visit(0, comboK, 0)

  const segStart: number[] = []
  let total = 0
  for (const size of segSize) {
    segStart.push(total)
    total += size
  }
  if (segSize.length > COST_LAYOUT_VEC4S - HEADER_VEC4S) {
    throw new Error('Cost layout exceeds the shader segment table')
  }
  if (total > 0xFFFFFFFF) {
    throw new Error('Cost-legal combo count exceeds the u32 rank space')
  }

  const uniform = new Uint32Array(COST_LAYOUT_VEC4S * 4)
  uniform[0] = groupCosts.length
  uniform[1] = segSize.length
  uniform[2] = comboK
  for (let group = 0; group < groupCosts.length; group += 1) {
    uniform[4 + group] = groupStart[group]!
    uniform[8 + group] = groupSize[group]!
  }
  segSize.forEach((size, segment) => {
    const base = (HEADER_VEC4S + segment) * 4
    uniform[base] = segStart[segment]!
    uniform[base + 1] = segCounts[segment]!.reduce((packed, count, group) => packed | (count << (group * 4)), 0)
    uniform[base + 2] = size
  })

  return { indexMap, comboK, lockedIndex, total, groupStart, groupSize, segStart, segSize, segCounts, uniform }
}

// decode one cost-legal rank into echo indices. the locked main, when present,
// fills the final slot exactly as the shader does.
export function nrnkCostCombo(
    rankInput: number,
    layout: CostLayout,
    binom: Uint32Array,
    out: Int32Array,
): Int32Array {
  out.fill(-1)
  const rank = rankInput >>> 0
  let segment = layout.segStart.length - 1
  while (segment > 0 && layout.segStart[segment]! > rank) segment -= 1

  const counts = layout.segCounts[segment] ?? []
  let local = rank - (layout.segStart[segment] ?? 0)
  const subRanks = new Array<number>(counts.length).fill(0)
  for (let group = counts.length - 1; group >= 0; group -= 1) {
    const size = choose(binom, layout.groupSize[group]!, counts[group]!)
    subRanks[group] = local % size
    local = Math.floor(local / size)
  }

  let pos = 0
  for (let group = 0; group < counts.length; group += 1) {
    const n = layout.groupSize[group]!
    let remainingK = counts[group]!
    let sub = subRanks[group]!
    let start = 0
    while (remainingK > 0) {
      for (let i = start; i < n; i += 1) {
        const count = choose(binom, n - i - 1, remainingK - 1)
        if (sub >= count) {
          sub -= count
          continue
        }
        out[pos] = layout.indexMap[layout.groupStart[group]! + i]!
        pos += 1
        start = i + 1
        remainingK -= 1
        break
      }
    }
  }

  if (layout.lockedIndex >= 0 && layout.comboK < out.length) {
    out[out.length - 1] = layout.lockedIndex
  }
  return out
}
