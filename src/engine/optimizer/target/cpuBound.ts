/*
  Author: Runor Ewhro
  description: builds conservative cost-aware suffix bounds and traversal order
               for CPU target branch-and-bound.
*/

import { ECHO_STAT_STRIDE, MAIN_BUFF_LEN } from '@/engine/search/layout/echoLayout.ts'
import { ECHOES_PER_SET, MAX_ECHO_COST, SET_SLOT_COUNT } from '@/engine/search/layout/constants.ts'
import { DISABLED_CONSTRAINTS } from '@/engine/search/score/statConstraints.ts'
import { makeCpuScratch } from '@/engine/optimizer/cpu/scratch.ts'
import { evalTgtCpuCmPrepped, mkCmbBaseStt, clrCmbSetStt } from '@/engine/optimizer/target/cpu.ts'
import { newSetRows, SET_ROW_FLOATS } from '@/engine/optimizer/gpu/targetBound.ts'

// most free slots a prefix may leave to the bound
const MAX_FREE = 3
// sets whose runtime-gated bonuses read piece counts beyond the lut rows
const GATED_SETS = [14, 22, 29, 33]
// absorbs f32 stat rows summed in a different order than the real combo
const MARGIN = 1.0001

export interface TgtCpuBoundInput {
  contexts: readonly Float32Array[]
  stats: Float32Array
  costs: Uint8Array
  sets: Uint8Array
  kinds: Uint16Array
  mainEchoBuffs: Float32Array
  setConstLut: Float32Array
}

// per cost ceiling and free count, the field-wise sum of the free count
// largest values over echoes at or after each walk position, plus the max
// main row
function suffixTables(input: TgtCpuBoundInput, order: Int32Array, ceiling: number) {
  const n = input.costs.length
  const top = Array.from({ length: MAX_FREE + 1 }, () => new Float32Array((n + 1) * ECHO_STAT_STRIDE))
  const mains = new Float32Array((n + 1) * MAIN_BUFF_LEN)
  const best = new Float32Array(MAX_FREE * ECHO_STAT_STRIDE).fill(-Infinity)
  const mainBest = new Float32Array(MAIN_BUFF_LEN).fill(-Infinity)
  for (let position = n - 1; position >= 0; position -= 1) {
    const index = order[position]!
    if (input.costs[index]! <= ceiling) {
      for (let field = 0; field < ECHO_STAT_STRIDE; field += 1) {
        // insert into this field's descending top list
        let value = input.stats[index * ECHO_STAT_STRIDE + field]!
        for (let rank = 0; rank < MAX_FREE; rank += 1) {
          const slot = rank * ECHO_STAT_STRIDE + field
          if (value > best[slot]!) { const held = best[slot]!; best[slot] = value; value = held }
        }
      }
      for (let field = 0; field < MAIN_BUFF_LEN; field += 1) {
        mainBest[field] = Math.max(mainBest[field]!, input.mainEchoBuffs[index * MAIN_BUFF_LEN + field]!)
      }
    }
    for (let free = 1; free <= MAX_FREE; free += 1) {
      for (let field = 0; field < ECHO_STAT_STRIDE; field += 1) {
        let sum = 0
        for (let rank = 0; rank < free; rank += 1) sum += Math.max(0, best[rank * ECHO_STAT_STRIDE + field]!)
        top[free]![position * ECHO_STAT_STRIDE + field] = sum
      }
    }
    for (let field = 0; field < MAIN_BUFF_LEN; field += 1) {
      mains[position * MAIN_BUFF_LEN + field] = Math.max(0, mainBest[field]!)
    }
  }
  return { top, mains }
}

// returns upper(prefix, depth, costSum, after): at least the damage of every
// legal completion of the first depth picks by echoes from walk position
// after on (Infinity when it cannot bound them)
export function mkTgtCpuBound(input: TgtCpuBoundInput, lockMainIdx: number, order: Int32Array) {
  const n = input.costs.length
  const ceilings = [...new Set(input.costs)].sort((a, b) => a - b)
  const minCost = ceilings[0] ?? 1
  const tables = new Map(ceilings.map((ceiling) => [ceiling, suffixTables(input, order, ceiling)]))
  const setRows = newSetRows(input.setConstLut)
  const scratch = makeCpuScratch()
  // one extra main row past the inventory stores the free slots' best main
  const virtual = n
  const mainEchoBuffs = new Float32Array((n + 1) * MAIN_BUFF_LEN)
  mainEchoBuffs.set(input.mainEchoBuffs.subarray(0, n * MAIN_BUFF_LEN))
  const comboIds = new Int32Array(ECHOES_PER_SET)

  return (prefix: Int32Array, depth: number, costSum: number, after: number): number => {
    const free = ECHOES_PER_SET - depth
    if (free < 1 || free > MAX_FREE) return Infinity
    // every free echo leaves at least the cheapest cost for the others
    const each = MAX_ECHO_COST - costSum - (free - 1) * minCost
    let ceiling = -1
    for (const cost of ceilings) if (cost <= each) ceiling = cost
    if (ceiling < 0) return Infinity
    const table = tables.get(ceiling)!

    for (let slot = 0; slot < depth; slot += 1) comboIds[slot] = prefix[slot]!
    for (let slot = depth; slot < ECHOES_PER_SET; slot += 1) comboIds[slot] = virtual
    const touched = mkCmbBaseStt(scratch, input.stats, input.sets, input.kinds, prefix.subarray(0, depth))
    const base = scratch.baseCmbVctr
    const top = table.top[free]!
    for (let field = 0; field < ECHO_STAT_STRIDE; field += 1) base[field] += top[after * ECHO_STAT_STRIDE + field]!
    // free slots may join any held set; gated sets may also open fresh
    const counts = scratch.setCounts
    const raised: number[] = []
    for (let index = 0; index < touched; index += 1) raised.push(scratch.tchdSetIds[index]!)
    for (const set of GATED_SETS) if (set < SET_SLOT_COUNT && !raised.includes(set)) raised.push(set)
    for (const set of raised) counts[set] = Math.min(5, counts[set]! + free)
    mainEchoBuffs.set(table.mains.subarray(after * MAIN_BUFF_LEN, (after + 1) * MAIN_BUFF_LEN), virtual * MAIN_BUFF_LEN)

    let bound = 0
    for (const context of input.contexts) {
      const evaluated = evalTgtCpuCmPrepped({
        context,
        setConstLut: input.setConstLut,
        mainEchoBuffs,
        constraints: DISABLED_CONSTRAINTS,
        comboIds,
        lockMainIdx,
        scratch,
        setBonusExtra: setRows.subarray(free * SET_ROW_FLOATS, (free + 1) * SET_ROW_FLOATS),
      })
      bound = Math.max(bound, evaluated?.damage ?? 0)
    }
    clrCmbSetStt(scratch, touched)
    for (const set of raised) counts[set] = 0
    return bound * MARGIN
  }
}

// walk order for the cpu search: cost groups from the highest cost, each
// strongest first by the damage its echo scores alone as main. any order
// emits the same combos; this one leaves the weakest echoes to the free
// slots, so prefixes bound tightly and the floor rises early.
export function mkTgtCpuOrder(input: TgtCpuBoundInput): Int32Array {
  const n = input.costs.length
  const scratch = makeCpuScratch()
  const comboIds = new Int32Array(ECHOES_PER_SET)
  const solo = new Float64Array(n)
  for (let index = 0; index < n; index += 1) {
    scratch.baseCmbVctr.fill(0)
    scratch.baseCmbVctr.set(input.stats.subarray(index * ECHO_STAT_STRIDE, (index + 1) * ECHO_STAT_STRIDE))
    comboIds.fill(index)
    for (const context of input.contexts) {
      const evaluated = evalTgtCpuCmPrepped({ context, setConstLut: input.setConstLut, mainEchoBuffs: input.mainEchoBuffs,
        constraints: DISABLED_CONSTRAINTS, comboIds, lockMainIdx: -1, scratch })
      solo[index] = Math.max(solo[index]!, evaluated?.damage ?? 0)
    }
  }
  return Int32Array.from(Array.from({ length: n }, (_, index) => index)
    .sort((a, b) => input.costs[b]! - input.costs[a]! || solo[b]! - solo[a]! || a - b))
}
