/*
  Author: Runor Ewhro
  description: generates cpu-side batches of 5-echo optimizer combinations,
               optionally enforcing a locked main echo, while pruning any
               branch whose accumulated echo cost already exceeds the max.
*/

import { MAX_ECHO_COST, ECHOES_PER_SET } from '@/engine/search/layout/constants.ts'

export interface TgtCpuCmbBtc {
  // flat packed combo indices, stored as consecutive groups of 5
  combos: Int32Array

  // number of 5-index combos currently stored in `combos`
  comboCount: number
}

// legal completions of a prefix: picks of `free` echoes from index `after` on
// with total cost within `budget`, holding the locked echo when it is still
// owed. counted per cost class so a pruned branch reports its exact size.
function mkTailCounter(costs: Uint8Array, lockedMainIndex: number) {
  const classes = [...new Set(costs)].sort((a, b) => a - b)
  const n = costs.length
  // suffix[index][class] = echoes at or after index in that class, lock excluded
  const suffix = new Int32Array((n + 1) * classes.length)
  for (let index = n - 1; index >= 0; index -= 1) {
    suffix.copyWithin(index * classes.length, (index + 1) * classes.length, (index + 2) * classes.length)
    if (index !== lockedMainIndex) suffix[index * classes.length + classes.indexOf(costs[index]!)]! += 1
  }
  const choose = (m: number, k: number) => {
    if (k < 0 || k > m) return 0
    let out = 1
    for (let i = 0; i < k; i += 1) out = out * (m - i) / (i + 1)
    return out
  }
  const count = (after: number, free: number, budget: number, cls = 0): number => {
    if (free === 0) return 1
    if (cls >= classes.length || budget < 0) return 0
    let total = 0
    const have = suffix[after * classes.length + cls]!
    for (let take = 0; take <= free && take * classes[cls]! <= budget; take += 1) {
      const ways = choose(have, take)
      if (ways > 0) total += ways * count(after, free - take, budget - take * classes[cls]!, cls + 1)
    }
    return total
  }
  return (after: number, free: number, budget: number, hasLocked: boolean): number => {
    if (lockedMainIndex < 0 || hasLocked) return count(after, free, budget)
    if (lockedMainIndex < after) return 0
    return count(after, free - 1, budget - costs[lockedMainIndex]!)
  }
}

export function* gnrtTgtCpuCm(options: {
  costs: Uint8Array
  batchSize: number
  lockMainIdx?: number
  borrowBuffer?: (length: number) => Int32Array
  // walk order over echo indices (identity when absent); any order emits the
  // same combos, a strongest-first order just lets prune cut sooner
  order?: Int32Array
  // asked after two and after three picks, with the walk position the next
  // pick starts from: true skips every completion
  prune?: (prefix: Int32Array, depth: number, costSum: number, after: number) => boolean
  // combos skipped by prune, for progress
  onPruned?: (count: number) => void
}): Generator<TgtCpuCmbBtc> {
  const { costs, batchSize } = options
  const lockedMainIndex = options.lockMainIdx ?? -1
  const n = costs.length

  // cannot form a valid optimizer combo if fewer than 5 echoes exist
  if (n < ECHOES_PER_SET) {
    return
  }

  // if the locked main alone already exceeds the cost cap, no combo can work
  if (lockedMainIndex >= 0 && ((costs[lockedMainIndex] | 0) > MAX_ECHO_COST)) {
    return
  }

  // stores the current five-echo combination during dfs
  const combo = new Int32Array(ECHOES_PER_SET)
  const order = options.order
  const walkCosts = order ? Uint8Array.from(order, (echo) => costs[echo]!) : costs
  const lockPosition = order ? order.indexOf(lockedMainIndex) : lockedMainIndex
  const tail = options.prune ? mkTailCounter(walkCosts, lockPosition) : null

  // one batch stores `batchSize` combos, each combo taking 5 slots
  const batchLength = Math.max(1, batchSize) * ECHOES_PER_SET

  // scratch buffer for the current outgoing batch
  let scratch = options.borrowBuffer?.(batchLength) ?? new Int32Array(batchLength)

  // how many full combos have been written into the current scratch buffer
  let cursor = 0

  // packages the current scratch buffer as one yielded batch and resets state
  const flush = () => {
    if (cursor <= 0) {
      return null
    }

    const out: TgtCpuCmbBtc = {
      combos: scratch,
      comboCount: cursor,
    }

    scratch = options.borrowBuffer?.(batchLength) ?? new Int32Array(batchLength)
    cursor = 0
    return out
  }

  // writes the current 5-index combo into the active scratch batch
  function* emitCombo(): Generator<TgtCpuCmbBtc> {
    scratch.set(combo, cursor * ECHOES_PER_SET)
    cursor += 1

    // once the batch is full, yield it immediately
    if (cursor >= batchSize) {
      const out = flush()
      if (out) {
        yield out
      }
    }
  }

  // depth-first enumeration of strictly increasing 5-index combinations
  function* dfs(
      depth: number,
      start: number,
      costSum: number,
      hasLocked: boolean,
  ): Generator<TgtCpuCmbBtc> {
    // reached 5 picked echoes
    if (depth === ECHOES_PER_SET) {
      // reject combos that do not include the requested locked main
      if (lockedMainIndex >= 0 && !hasLocked) {
        return
      }

      yield* emitCombo()
      return
    }

    // remaining slots including the current depth
    const rmnnSlts = ECHOES_PER_SET - depth

    // latest valid starting point that still leaves enough items to fill the combo
    const maxStart = n - rmnnSlts

    for (let position = start; position <= maxStart; position += 1) {
      // past the locked echo without holding it, nothing below can hold it
      if (lockedMainIndex >= 0 && !hasLocked && position > lockPosition) {
        break
      }
      const index = order ? order[position]! : position
      const nextCost = costSum + (costs[index] | 0)

      // prune branches that already exceed the total echo cost cap
      if (nextCost > MAX_ECHO_COST) {
        continue
      }

      combo[depth] = index

      const picked = depth + 1
      const containsLocked = hasLocked || index === lockedMainIndex
      if (tail && (picked === 2 || picked === 3) && options.prune!(combo, picked, nextCost, position + 1)) {
        options.onPruned?.(tail(position + 1, ECHOES_PER_SET - picked, MAX_ECHO_COST - nextCost, containsLocked))
        continue
      }

      yield* dfs(
          depth + 1,
          position + 1,
          nextCost,
          containsLocked,
      )
    }
  }

  // begin recursive generation from an empty combo
  yield* dfs(0, 0, 0, false)

  // emit any partially filled final batch
  const leftover = flush()
  if (leftover) {
    yield leftover
  }
}
