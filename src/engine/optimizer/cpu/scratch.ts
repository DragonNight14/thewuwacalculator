/*
  Author: Runor Ewhro
  description: provides reusable cpu scratch buffers for combo evaluation.
*/

import { ECHOES_PER_SET, SET_SLOT_COUNT, FULL_STAT_STRIDE } from '@/engine/search/layout/constants.ts'

export interface CpuScratch {
  comboIds: Int32Array
  cmbPstn: Int32Array
  baseCmbVctr: Float64Array
  setCounts: Uint8Array
  tchdSetIds: Uint8Array
  setMasks: Uint32Array
}

// create one reusable scratch object for cpu combo evaluation
export function makeCpuScratch(): CpuScratch {
  return {
    // current combo echo indices
    comboIds: new Int32Array(ECHOES_PER_SET),

    // optional positional mapping for combo processing
    cmbPstn: new Int32Array(ECHOES_PER_SET),

    // summed combo stats before main-echo-only buffs are applied. f64 so the
    // search totals match the row scorer exactly
    baseCmbVctr: new Float64Array(FULL_STAT_STRIDE),

    // per-set piece counts for the active combo
    setCounts: new Uint8Array(SET_SLOT_COUNT),

    // touched set ids for selective clearing
    tchdSetIds: new Uint8Array(ECHOES_PER_SET),

    // reusable set masks for encoded set logic
    setMasks: new Uint32Array(SET_SLOT_COUNT),
  }
}
