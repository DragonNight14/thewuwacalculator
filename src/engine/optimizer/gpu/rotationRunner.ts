/*
  Author: Runor Ewhro
  description: runs rotation optimizer jobs on the gpu and decodes candidate results.
*/

import {
  makeStoreBuffer,
  ensureGpuBuffer,
  GPU_CAND_STRIDE,
  readAppendedCands,
  sortCnddByDm,
  toGpuPldView,
  writeGpuBffr,
  type ReusableBuffer,
} from '@/engine/optimizer/gpu/common.ts'
import { getRotGpuPpl } from '@/engine/optimizer/gpu/rotationPipeline.ts'
import { COST_LAYOUT_VEC4S, mkCostLayout, nrnkCostCombo, type CostLayout } from '@/engine/optimizer/combos/costLayout.ts'
import { dispCmptPass } from '@/engine/optimizer/gpu/dispatch.ts'
import { getGpuDevice } from '@/engine/optimizer/gpu/getDevice.ts'
import { GpuResourceSession } from '@/engine/optimizer/gpu/GpuResourceSession.ts'
import {
  ptchTgtCtxFo,
} from '@/engine/search/context/pack.ts'
import {
  CTX_FLOATS,
  MAX_ECHO_COST,
  WEAPON_BIT_MASK,
  WEAPON_RANK_MASK,
  WEAPON_INDEX_SHIFT,
  NATIVE_ROTATION_WORKGROUP_SIZE,
  NATIVE_ROTATION_CYCLES,
} from '@/engine/search/layout/constants.ts'
import {
  GPU_APPEND_HEADER,
  GPU_APPEND_INLINE,
  TARGET_GPU_PRIME_COMBOS,
  GPU_COMBO_MODE_BATCH,
  GPU_DECODE_OVERSAMPLE,
} from '@/engine/optimizer/config/constants.ts'
import { gpuPipelineDepth, targetGpuFrameCombos } from '../config/batching'
import { OptResultSet } from '@/engine/optimizer/results/collector.ts'
import { packPortableGpuPrograms } from '@/engine/rotation/portable/gpu'
import type {
  OptBagResult,
  PckdRotXctnP,
} from '@/engine/optimizer/types.ts'

interface RotGpuJobPay {
  // absolute combo start index for this job inside the global search space
  comboStart: number

  // number of combos this job is responsible for processing
  comboCount: number

  // fixed main echo index for locked-main mode, or -1 when unlocked
  lockMainIdx: number

  // maximum number of final results this job should keep
  jobResultLimit: number
}

interface RotGpuBtcPay {
  combosBatch: Int32Array
  comboCount: number
  lockMainIdx: number
  jobResultLimit: number
}

interface RotGpuRunHks {
  // cancellation hook checked before and after major gpu stages
  isCancelled?: () => boolean
  // run id for sharing the score floor across this worker's jobs
  runId?: number
}

interface RotGpuSttcSt {
  // core gpu objects
  device: GPUDevice
  layout: GPUBindGroupLayout
  pipeline: GPUComputePipeline
  // theory batch pipeline: one combo per thread (one candidate per combo).

  // original packed execution payload used to initialize this state
  execution: PckdRotXctnP

  // static buffers uploaded once per initialization
  statsBuffer: GPUBuffer
  setCnstLutns: GPUBuffer
  setsBuffer: GPUBuffer
  comboMapBox: GPUBuffer
  echoCstsBffr: GPUBuffer
  mainEchoBuff: GPUBuffer
  cstrsBffr: GPUBuffer
  kindBuffer: GPUBuffer
  cmbBnmBffr: GPUBuffer
  rotCntxBffr: GPUBuffer
  rotMetaBffr: GPUBuffer

  // reusable per-job buffers
  paramsReuse: ReusableBuffer
  candRs: ReusableBuffer
  candRdbcRs: ReusableBuffer
  candInlineRs: ReusableBuffer
  comboRs: ReusableBuffer

  // reusable buffers for the optional reduction pass
  reduceReuse: {
    output: ReusableBuffer
    params: ReusableBuffer
  }

  // recreate the cached bind group when candidate or parameter buffers change.
  bindGroup: GPUBindGroup | null
  bindGroupBuffer: {
    candidates: GPUBuffer | null
    params: GPUBuffer | null
    indexMap: GPUBuffer | null
  }

  // tracks which locked main index the uploaded combo index map currently matches
  actLockMaiok: number

  // generated kernels walk cost-legal ranks: the layout uniform, and which
  // lock's cost-sorted index map is uploaded (null: the plain map)
  costLayoutBuf: GPUBuffer
  costLock: number | null
}

// each worker keeps the buffers for one initialized rotation payload.
const jobFrames = new WeakMap<RotGpuSttcSt, RotGpuSttcSt[]>()
function destroyJobBuffers(state: RotGpuSttcSt): void {
  destroyBuffer(state.paramsReuse)
  destroyBuffer(state.candRs)
  destroyBuffer(state.candRdbcRs)
  destroyBuffer(state.candInlineRs)
  destroyBuffer(state.comboRs)
  destroyBuffer(state.reduceReuse.output)
  destroyBuffer(state.reduceReuse.params)
}
const rotGpuSession = new GpuResourceSession<RotGpuSttcSt>((state) => {
  destroyJobBuffers(state)
  for (const frame of jobFrames.get(state) ?? []) {
    destroyJobBuffers(frame)
    frame.comboMapBox.destroy()
    frame.costLayoutBuf.destroy()
  }

  state.statsBuffer.destroy()
  state.setCnstLutns.destroy()
  state.setsBuffer.destroy()
  state.comboMapBox.destroy()
  state.echoCstsBffr.destroy()
  state.mainEchoBuff.destroy()
  state.cstrsBffr.destroy()
  state.kindBuffer.destroy()
  state.cmbBnmBffr.destroy()
  state.rotCntxBffr.destroy()
  state.rotMetaBffr.destroy()
  state.costLayoutBuf.destroy()
})

/** same device, program and immutable inputs; separate mutable buffers for
 * each outstanding submission/readback. no extra shader compilation/device. */
function rotationJobFrame(state: RotGpuSttcSt, slot: number): RotGpuSttcSt {
  if (slot === 0) return state
  let frames = jobFrames.get(state)
  if (!frames) { frames = []; jobFrames.set(state, frames) }
  let frame = frames[slot - 1]
  if (!frame) {
    frame = { ...state,
      comboMapBox: makeStoreBuffer(state.device, state.execution.comboIndexMap),
      actLockMaiok: state.execution.lockMainReq ? state.execution.lockMainCands[0] ?? -1 : -1,
      costLayoutBuf: makeCostLayoutBuffer(state.device), costLock: null,
      paramsReuse: { buffer: null, size: 0 }, candRs: { buffer: null, size: 0 },
      candRdbcRs: { buffer: null, size: 0 }, candInlineRs: { buffer: null, size: 0 }, comboRs: { buffer: null, size: 0 },
      reduceReuse: { output: { buffer: null, size: 0 }, params: { buffer: null, size: 0 } },
      bindGroup: null, bindGroupBuffer: { candidates: null, params: null, indexMap: null },
    }
    frames[slot - 1] = frame
  }
  return frame
}

// the run's best top-k floor so far, carried across this worker's jobs
let runFloor = { runId: undefined as number | undefined, value: 0 }

async function pipelineRotationJob(state: RotGpuSttcSt, count: number, limit: number, hooks: RotGpuRunHks,
  execute: (offset: number, count: number, frame: RotGpuSttcSt, floor: number) => Promise<OptBagResult[]>,
  floored = false,
): Promise<OptBagResult[]> {
  const collector = new OptResultSet(limit, state.execution.lowMmryMode)
  const lowMemory = state.execution.lowMmryMode ?? false
  const depth = gpuPipelineDepth(lowMemory)
  const width = NATIVE_ROTATION_WORKGROUP_SIZE * NATIVE_ROTATION_CYCLES
  // size frames by the candidate buffer; the readback contains only
  // candidates above the current floor.
  const chunk = targetGpuFrameCombos(count, width, lowMemory,
    state.device.limits.maxStorageBufferBindingSize, state.device.limits.maxBufferSize, !floored)
  if (runFloor.runId !== hooks.runId) runFloor = { runId: hooks.runId, value: 0 }
  // inside one inventory job every combo is a distinct echo set, so the job's
  // the k-th score is exact within a job; use the highest floor across jobs.
  const floor = () => floored ? Math.max(runFloor.value, collector.floor) : 0
  let next = 0
  // with no floor yet, every candidate of the first frames reads back. score a
  // small priming frame alone first so the frames after it filter on the GPU.
  if (floored && floor() === 0 && count > chunk && !hooks.isCancelled?.()) {
    next = Math.min(TARGET_GPU_PRIME_COMBOS, chunk)
    for (const result of await execute(0, next, state, 0)) collector.push(result)
  }
  const slots = Math.min(depth, Math.ceil((count - next) / chunk))
  const outcomes = await Promise.allSettled(Array.from({ length: slots }, async (_, slot) => {
    const frame = rotationJobFrame(state, slot)
    while (next < count && !hooks.isCancelled?.()) {
      const offset = next, length = Math.min(chunk, count - offset)
      next += length
      for (const result of await execute(offset, length, frame, floor())) collector.push(result)
    }
  }))
  const failed = outcomes.find(outcome => outcome.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  if (floored) runFloor.value = Math.max(runFloor.value, collector.floor)
  return collector.sorted()
}

// destroy one reusable buffer wrapper and reset it to an empty state
function destroyBuffer(reuse: ReusableBuffer): void {
  reuse.buffer?.destroy()
  reuse.buffer = null
  reuse.size = 0
}

// fully destroy all persistent rotation gpu resources
// release the current payload buffers before loading the next gpu state
function dstrRotGpuSt(): void {
  rotGpuSession.dispose()
}

// helper: convert compact uint8 data into float32 for shader storage buffers
// some gpu paths prefer all numeric payloads in float buffers
function toGpuFltRry(values: Uint8Array): Float32Array {
  const out = new Float32Array(values.length)
  for (let index = 0; index < values.length; index += 1) {
    out[index] = values[index] ?? 0
  }
  return out
}

// helper: convert uint16 ids into int32 values for shader consumption
function toGpuIntRry(values: Uint16Array): Int32Array {
  const out = new Int32Array(values.length)
  for (let index = 0; index < values.length; index += 1) {
    out[index] = values[index] ?? 0
  }
  return out
}

// state guard used by runtime job execution functions
function ensRotGpuStt(): RotGpuSttcSt {
  if (!rotGpuSession.current) {
    throw new Error('Rotation GPU worker state has not been initialized')
  }

  return rotGpuSession.current
}

// constraints are used as uniforms, so keep them in a uniform-compatible buffer
function mkCstrsBffr(device: GPUDevice, constraints: Float32Array): GPUBuffer {
  const buffer = device.createBuffer({
    size: Math.max(16, constraints.byteLength),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  if (constraints.byteLength > 0) {
    device.queue.writeBuffer(buffer, 0, toGpuPldView(constraints))
  }

  return buffer
}

// create or reuse the bind group for the current candidate and params buffers
// everything else is static per initialization and stays bound to persistent buffers
function getBindGroup(
    state: RotGpuSttcSt,
    candidateBuffer: GPUBuffer,
    paramsBuffer: GPUBuffer,
    indexMapBffr: GPUBuffer,
): GPUBindGroup {
  const ndsRcrt =
      !state.bindGroup ||
      state.bindGroupBuffer.candidates !== candidateBuffer ||
      state.bindGroupBuffer.params !== paramsBuffer ||
      state.bindGroupBuffer.indexMap !== indexMapBffr

  if (!ndsRcrt) {
    return state.bindGroup as GPUBindGroup
  }

  state.bindGroup = state.device.createBindGroup({
    label: 'optimizer-rotation-bind-group',
    layout: state.layout,
    entries: [
      // 0: encoded echo stat rows
      { binding: 0, resource: { buffer: state.statsBuffer } },

      // 1: set lookup table
      { binding: 1, resource: { buffer: state.setCnstLutns } },

      // 2: set ids per echo
      { binding: 2, resource: { buffer: state.setsBuffer } },

      // 3: combo index map, or explicit theory rows in batch mode
      { binding: 3, resource: { buffer: indexMapBffr } },

      // 4: per-job params / patched context
      { binding: 4, resource: { buffer: paramsBuffer } },

      // 5: echo costs
      { binding: 5, resource: { buffer: state.echoCstsBffr } },

      // 6: main echo bonus rows
      { binding: 6, resource: { buffer: state.mainEchoBuff } },

      // 7: constraints uniform
      { binding: 7, resource: { buffer: state.cstrsBffr } },

      // 8: kind ids
      { binding: 8, resource: { buffer: state.kindBuffer } },

      // 9: output candidate buffer
      { binding: 9, resource: { buffer: candidateBuffer } },

      // 10: binomial table
      { binding: 10, resource: { buffer: state.cmbBnmBffr } },

      // 11: packed rotation contexts + weights
      { binding: 11, resource: { buffer: state.rotCntxBffr } },

      // 12: small metadata uniform (weapon count)
      { binding: 12, resource: { buffer: state.rotMetaBffr } },

      // 13: cost-legal enumeration layout (generated kernels)
      { binding: 13, resource: { buffer: state.costLayoutBuf } },
    ],
  })

  state.bindGroupBuffer = {
    candidates: candidateBuffer,
    params: paramsBuffer,
    indexMap: indexMapBffr,
  }

  return state.bindGroup
}

// initialize all static gpu state for one packed rotation execution payload
// any previous state is destroyed first
export async function initRotGpu(payload: PckdRotXctnP): Promise<void> {
  dstrRotGpuSt()

  const device = await getGpuDevice()
  const { layout, pipeline } = await getRotGpuPpl(device, payload)

  rotGpuSession.current = {
    device,
    layout,
    pipeline,
    execution: payload,

    // upload all mostly-static buffers once
    statsBuffer: makeStoreBuffer(device, payload.stats),
    setCnstLutns: makeStoreBuffer(device, payload.setConstLut),
    setsBuffer: makeStoreBuffer(device, toGpuFltRry(payload.sets)),
    comboMapBox: makeStoreBuffer(device, payload.comboIndexMap),
    echoCstsBffr: makeStoreBuffer(device, toGpuFltRry(payload.costs)),
    mainEchoBuff: makeStoreBuffer(device, payload.mainEchoBuffs),
    cstrsBffr: mkCstrsBffr(device, payload.constraints),
    kindBuffer: makeStoreBuffer(device, toGpuIntRry(payload.kinds)),
    cmbBnmBffr: makeStoreBuffer(device, payload.comboBinom),
    rotCntxBffr: makeStoreBuffer(device, packPortableGpuPrograms(payload)),

    // tiny uniform holding the weapon count
    rotMetaBffr: device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),

    // reusable runtime buffers
    paramsReuse: { buffer: null, size: 0 },
    candRs: { buffer: null, size: 0 },
    candRdbcRs: { buffer: null, size: 0 },
    candInlineRs: { buffer: null, size: 0 },
    comboRs: { buffer: null, size: 0 },

    // reduction scratch
    reduceReuse: {
      output: { buffer: null, size: 0 },
      params: { buffer: null, size: 0 },
    },

    bindGroup: null,
    bindGroupBuffer: {
      candidates: null,
      params: null,
      indexMap: null,
    },

    // if locked-main mode is enabled, assume first candidate index is the current uploaded mapping
    actLockMaiok: payload.lockMainReq
        ? (payload.lockMainCands[0] ?? -1)
        : -1,

    costLayoutBuf: makeCostLayoutBuffer(device),
    costLock: null,
  }

  // metadata: the candidate weapon count, read by batch frames to pack weapon indices
  device.queue.writeBuffer(rotGpuSession.current.rotMetaBffr, 0, Uint32Array.of(payload.weaponCount ?? 0, 0, 0, 0))
}

// build the uniform payload for one rotation gpu job
// this reuses the existing context patcher to keep packing behavior consistent
function mkRotJobPrms(options: {
  comboN: number
  comboK: number
  comboCount: number
  comboBaseIndex: number
  lockEchoIdx: number
  comboMode?: number
  candidateFloor?: number
}): Float32Array {
  return ptchTgtCtxFo({
    baseContext: new Float32Array(CTX_FLOATS),
    comboN: options.comboN,
    comboK: options.comboK,
    comboCount: options.comboCount,
    comboBaseIndex: options.comboBaseIndex,
    lockEchoIdx: options.lockEchoIdx,
    comboMode: options.comboMode,
    candidateFloor: options.candidateFloor,
  })
}

// decode packed candidate rank field.
// default layout: lower 29 bits -> combo rank, upper 3 bits -> main position.
// weapon-search layout: lower 27 bits -> combo rank, upper 5 bits -> weapon
// index (the main is pinned to slot 0, so mainPos is always 0).
function dcdPckdCndd(
    candidates: Array<{ damage: number; rank: number }>,
    weaponMode = false,
): Array<{ damage: number; rank: number; mainPos: number; weapon: number }> {
  const out: Array<{ damage: number; rank: number; mainPos: number; weapon: number }> = []

  for (const candidate of candidates) {
    const packed = candidate.rank >>> 0
    if (weaponMode) {
      out.push({
        damage: candidate.damage,
        rank: packed & WEAPON_RANK_MASK,
        mainPos: 0,
        weapon: (packed >>> WEAPON_INDEX_SHIFT) & WEAPON_BIT_MASK,
      })
    } else {
      out.push({
        damage: candidate.damage,
        rank: packed & 0x1fffffff,
        mainPos: packed >>> 29,
        weapon: -1,
      })
    }
  }

  return out
}

// the cost layout for one locked main (-1 when unlocked), cached per payload
const costLayoutCache = new WeakMap<PckdRotXctnP, Map<number, CostLayout>>()
function costLayoutFor(execution: PckdRotXctnP, lockedIndex: number): CostLayout {
  let layouts = costLayoutCache.get(execution)
  if (!layouts) { layouts = new Map(); costLayoutCache.set(execution, layouts) }
  let layout = layouts.get(lockedIndex)
  if (!layout) {
    layout = mkCostLayout(execution.costs, execution.comboK, lockedIndex, MAX_ECHO_COST, execution.comboBinom)
    layouts.set(lockedIndex, layout)
  }
  return layout
}

function makeCostLayoutBuffer(device: GPUDevice): GPUBuffer {
  return device.createBuffer({ size: COST_LAYOUT_VEC4S * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
}

// one frame of a generated rotation kernel. candidates at or above the floor
// append behind an atomic count; inventory frames walk ranks from comboStart,
// theory frames read their rows from combosBatch.
async function runPortableFrame(
    state: RotGpuSttcSt,
    job: RotGpuJobPay & { combosBatch?: Int32Array },
    floor: number,
    hooks: RotGpuRunHks,
): Promise<OptBagResult[]> {
  if (hooks.isCancelled?.() || job.comboCount <= 0) {
    return []
  }

  const execution = state.execution
  const batch = job.combosBatch
  const layout = batch ? null : costLayoutFor(execution, job.lockMainIdx)
  // inventory frames walk this lock's cost-sorted index map and layout
  if (layout && state.costLock !== job.lockMainIdx) {
    state.device.queue.writeBuffer(state.comboMapBox, 0, toGpuPldView(layout.indexMap))
    state.device.queue.writeBuffer(state.costLayoutBuf, 0, toGpuPldView(layout.uniform))
    state.costLock = job.lockMainIdx
  }

  const wgCnt = Math.ceil(job.comboCount / (NATIVE_ROTATION_WORKGROUP_SIZE * NATIVE_ROTATION_CYCLES))
  const candidateBuffer = ensureGpuBuffer(
      state.device,
      state.candRs,
      GPU_APPEND_HEADER + job.comboCount * GPU_CAND_STRIDE,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  )
  const params = mkRotJobPrms({
    comboN: layout?.indexMap.length ?? execution.comboN,
    comboK: layout?.comboK ?? 5,
    comboCount: job.comboCount,
    comboBaseIndex: batch ? 0 : job.comboStart,
    lockEchoIdx: job.lockMainIdx,
    comboMode: batch ? GPU_COMBO_MODE_BATCH : undefined,
    candidateFloor: floor,
  })
  const paramsBuffer = ensureGpuBuffer(
      state.device,
      state.paramsReuse,
      params.byteLength,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )
  state.device.queue.writeBuffer(paramsBuffer, 0, toGpuPldView(params))
  const indexBuffer = batch
      ? writeGpuBffr(state.device, state.comboRs, batch, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST)
      : state.comboMapBox
  const bindGroup = getBindGroup(state, candidateBuffer, paramsBuffer, indexBuffer)

  const submission = state.device.createCommandEncoder()
  // reset the append count
  submission.clearBuffer(candidateBuffer, 0, GPU_APPEND_HEADER)
  await dispCmptPass({
    device: state.device,
    pipeline: state.pipeline,
    bindGroup,
    wrkgCnt: wgCnt,
    encoder: submission,
  })

  const resultLimit = Math.max(1, job.jobResultLimit * GPU_DECODE_OVERSAMPLE)
  // with no floor nearly every combo appends: map the whole frame at once
  const { results } = await readAppendedCands(
      state.device,
      candidateBuffer,
      job.comboCount,
      floor > 0 ? GPU_APPEND_INLINE : job.comboCount,
      state.candInlineRs,
      state.candRdbcRs,
      resultLimit,
      submission,
  )
  if (hooks.isCancelled?.()) {
    return []
  }

  const weaponMode = Boolean(batch) && (execution.weaponCount ?? 0) > 0
  const decoded = dcdPckdCndd(results, weaponMode)
  sortCnddByDm(decoded)
  const collector = new OptResultSet(job.jobResultLimit)
  const comboIds = new Int32Array(5)
  let pushed = 0
  for (const candidate of decoded) {
    if (batch) {
      if (candidate.rank >= job.comboCount) continue
      comboIds.set(batch.subarray(candidate.rank * 5, candidate.rank * 5 + 5))
    } else {
      nrnkCostCombo(candidate.rank + job.comboStart, layout!, execution.comboBinom, comboIds)
    }
    const mainIndex = comboIds[candidate.mainPos] ?? -1
    if (mainIndex < 0) continue
    collector.pushRdrdCmb(candidate.damage, comboIds, mainIndex, weaponMode ? candidate.weapon : -1)
    pushed += 1
    if (pushed >= resultLimit) break
  }
  return collector.sorted(job.jobResultLimit)
}

export async function runRotGpuJob(job: RotGpuJobPay, hooks: RotGpuRunHks = {}): Promise<OptBagResult[]> {
  const state = ensRotGpuStt()
  return pipelineRotationJob(state, job.comboCount, job.jobResultLimit, hooks, (offset, count, frame, floor) =>
    runPortableFrame(frame, { ...job, comboStart: job.comboStart + offset, comboCount: count }, floor, hooks), true)
}

export async function runRotGpuBtc(job: RotGpuBtcPay, hooks: RotGpuRunHks = {}): Promise<OptBagResult[]> {
  const state = ensRotGpuStt()
  return pipelineRotationJob(state, job.comboCount, job.jobResultLimit, hooks, (offset, count, frame) =>
    runPortableFrame(frame, { ...job, comboStart: 0, comboCount: count,
      combosBatch: job.combosBatch.subarray(offset * 5, (offset + count) * 5) }, 0, hooks))
}
