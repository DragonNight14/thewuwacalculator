/*
  Author: Runor Ewhro
  description: resolves locked-main candidates and builds the common
               combinadic/counting payload
               used by both target and rotation optimizer runs.
*/

import type { OptStartPay } from '@/engine/optimizer/types.ts'
import { mkOptCmbnNdx } from '@/engine/optimizer/combos/combinadic.ts'
import type { EncEchoRows } from '@/engine/search/encode/echoes.ts'

// collect every inventory index allowed to serve as the locked main echo.
//
// behavior:
// - if no main echo is locked, every inventory echo index is eligible.
// - if a specific main echo id is locked, only matching inventory indices remain.
export function cllcLckdMain(input: OptStartPay): Int32Array {
  const picked = input.settings.lockedMainEchoId

  // unlocked main echo means all inventory entries are valid candidates.
  if (!picked) {
    return Int32Array.from(input.invChs.map((_, index) => index))
  }

  const indices: number[] = []

  // keep only indices whose echo id matches the requested locked main id.
  for (let index = 0; index < input.invChs.length; index += 1) {
    if (input.invChs[index]?.id === picked) {
      indices.push(index)
    }
  }

  return Int32Array.from(indices)
}

// build the shared optimizer payload fields that both target-mode and
// rotation-mode compilers need.
//
// this includes:
// - encoded echo cost/set/kind arrays
// - constraint vector
// - combinadic indexing tables
// - locked-main candidate indices
// - result limits and low-memory settings
// - a progress scaling factor used by the worker pool
export function mkShrdPay(
    encoded: Pick<EncEchoRows, 'costs' | 'sets' | 'kinds' | 'count'>,
    input: OptStartPay,
    constraints: Float32Array,
    baseline = false,
) {
  // resolve which inventory indices can act as the main echo.
  const lckdMainNdcs = baseline ? new Int32Array(0) : cllcLckdMain(input)

  // whether the user explicitly requested a locked main echo.
  const locked = Boolean(input.settings.lockedMainEchoId)

  // build combinadic indexing metadata for the inventory size.
  //
  // when a main echo is locked, the combinadic builder receives one concrete
  // the locked index seed determines combination dimensions.
  // the full candidate list is still preserved separately in lockedMainIndices.
  const comboIndex = baseline ? { comboN: 0, comboK: 0, totalCombos: 0, indexMap: new Int32Array(0), binom: new Uint32Array(0) } : mkOptCmbnNdx({
    echoCount: encoded.count,
    lockEchoIdx: locked ? (lckdMainNdcs[0] ?? null) : null,
  })

  return {
    scenarioId: input.scenarioId,
    memberId: input.memberId,
    // top-k / result retention settings
    resultsLimit: input.settings.resultsLimit,
    lowMmryMode: input.settings.lowMemoryMode,

    // constraint vector produced from optimizer settings
    constraints,

    // encoded inventory arrays reused by execution backends
    costs: encoded.costs,
    sets: encoded.sets,
    kinds: encoded.kinds,

    // combinadic indexing metadata for mapping combo ids to actual echo indices
    comboN: comboIndex.comboN,
    comboK: comboIndex.comboK,
    totalCombos: comboIndex.totalCombos,
    comboIndexMap: comboIndex.indexMap,
    comboBinom: comboIndex.binom,

    // locked-main metadata
    lockMainReq: locked,
    lockMainCands: lckdMainNdcs,

    // progress scaling:
    // - locked main -> each combo corresponds to one evaluation path
    // - unlocked main -> each combo is effectively explored across 5 main-row positions
    progFact: locked ? 1 : 5,
  }
}
