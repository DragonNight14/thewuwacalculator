/*
  Author: Runor Ewhro
  description: verifies target GPU frames respect candidate-buffer and device
               storage limits in inventory and explicit-combination modes.
*/

import { describe, expect, it } from 'vitest'
import { targetGpuFrameCombos } from '../batching'
import { CYCLES_PER_CALL, GPU_APPEND_HEADER, OPT_WG_SIZE, TARGET_GPU_SUBMISSION_COMBOS } from '../constants'

describe('target GPU frame sizing', () => {
  it('uses larger target frames while respecting GPU buffer limits', () => {
    const width = OPT_WG_SIZE * CYCLES_PER_CALL
    const storageLimit = 128 * 1024 * 1024
    expect(targetGpuFrameCombos(20_000_000, width, false, storageLimit, storageLimit))
      .toBe(TARGET_GPU_SUBMISSION_COMBOS)
    expect(targetGpuFrameCombos(20_000_000, width, true, storageLimit, storageLimit))
      .toBe(TARGET_GPU_SUBMISSION_COMBOS / 2)
    // the candidate buffer's append header counts against the binding limit
    const small = 2 * 1024 * 1024 - GPU_APPEND_HEADER
    expect(targetGpuFrameCombos(20_000_000, width, false, 2 * 1024 * 1024, storageLimit))
      .toBe(Math.floor(small / 8 / width) * width)
    expect(targetGpuFrameCombos(20_000_000, OPT_WG_SIZE, false, 2 * 1024 * 1024, storageLimit, true))
      .toBe(Math.floor(small / 20 / OPT_WG_SIZE) * OPT_WG_SIZE)
    expect(targetGpuFrameCombos(width, width, false, storageLimit, storageLimit))
      .toBe(width)
  })
})
