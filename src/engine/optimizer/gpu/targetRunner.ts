/*
  Author: Runor Ewhro
  description: runs target optimizer jobs on the gpu with bounded readbacks.
*/

import tgtCommonCode from '@/engine/optimizer/shaders/targetCommon.wgsl?raw'
import tgtShdrCode from '@/engine/optimizer/shaders/target.wgsl?raw'
import costCursorCode from '@/engine/optimizer/shaders/costCursor.wgsl?raw'
import wpnShdrCode from '@/engine/optimizer/shaders/weaponSearch.wgsl?raw'
import { withOptimizerDamageSpec } from '@/engine/optimizer/config/shaders.ts'
import {
  mkChckBindGr,
  mkChckCmptPp,
  ensureGpuBuffer,
  GPU_APPEND_HEADER,
  GPU_CAND_STRIDE,
  makeStoreBuffer,
  readAppendedCands,
  readCandBffr,
  sortCnddByDm,
  toGpuPldView,
  writeGpuBffr,
  type ReusableBuffer,
} from '@/engine/optimizer/gpu/common.ts'
import { mkCostLayout, nrnkCostCombo, type CostLayout } from '@/engine/optimizer/combos/costLayout.ts'
import { mkBoundData } from '@/engine/optimizer/gpu/targetBound.ts'
import { dispCmptPass } from '@/engine/optimizer/gpu/dispatch.ts'
import { getGpuDevice } from '@/engine/optimizer/gpu/getDevice.ts'
import { gpuPipelineDepth, targetGpuFrameCombos } from '../config/batching'
import { GpuResourceSession } from '@/engine/optimizer/gpu/GpuResourceSession.ts'
import {
  CYCLES_PER_CALL,
  GPU_COMBO_MODE_BATCH,
  GPU_REDUCE_K,
  OPT_WG_SIZE,
  LEGACY_BATCH_CYCLES,
  GPU_DECODE_OVERSAMPLE,
  GPU_APPEND_INLINE,
  TARGET_GPU_PRIME_COMBOS,
} from '@/engine/optimizer/config/constants.ts'
import {
  WEAPON_BIT_MASK,
  WEAPON_RANK_MASK,
  WEAPON_INDEX_SHIFT,
  WEAPON_OVERLAY_STRIDE,
  MAX_ECHO_COST,
  MAIN_BUFF_LEN,
  ARCHETYPE,
  META0,
} from '@/engine/search/layout/constants.ts'
import {
  OptResultSet,
} from '@/engine/optimizer/results/collector.ts'
import type {
  OptTgtGpuRsl,
  TargetGpuState,
} from '@/engine/optimizer/workers/messages.ts'
import {
  ptchTgtCtxDi,
  ptchTgtCtxFo,
} from '@/engine/search/context/pack.ts'

// both kernels share the scorer in targetCommon.wgsl
const targetShaderCode = withOptimizerDamageSpec(tgtCommonCode + tgtShdrCode + costCursorCode)
const weaponShaderCode = withOptimizerDamageSpec(tgtCommonCode + wpnShdrCode)

interface TgtGpuJobPay {
  // absolute combo start for this job within the global search space
  comboStart: number

  // number of combos this job should evaluate
  comboCount: number

  // locked main echo index for locked-main mode, or -1 when unlocked
  lockMainIdx: number

  // final result limit requested for this job
  jobResultLimit: number
}

interface TgtGpuBtcPay {
  combosBatch: Int32Array
  comboCount: number
  lockMainIdx: number
  jobResultLimit: number
}

interface TgtGpuRunHks {
  // optional cancellation callback checked during long-running jobs
  isCancelled?: () => boolean
  runId?: number
  // lowest damage that can still reach the run's top-k; inventory frames only
  // read back candidates at or above it
  floor?: () => number
}

interface TgtGpuSttcSt {
  // core gpu objects
  device: GPUDevice
  layout: GPUBindGroupLayout
  pipeline: GPUComputePipeline

  // small runtime payload reused across all jobs after initialization
  payload: TgtGpuRtPay

  // static buffers uploaded once per initialization
  echoSttsBffr: GPUBuffer
  setCnstLutns: GPUBuffer
  echoSetsBffr: GPUBuffer
  comboMapBox: GPUBuffer
  echoCstsBffr: GPUBuffer
  mainEchoBuff: GPUBuffer
  statCstrsBsy: GPUBuffer
  echoKindIdrr: GPUBuffer
  cmbBnmBffr: GPUBuffer

  // cost-legal enumeration layout for the locked main currently uploaded
  costLayoutBuf: GPUBuffer
  costLayouts: Map<number, CostLayout>
  mainClasses: Uint8Array

  // tile bound tables, cached per locked main; the uploaded one follows the
  // echo stat rows in echoSttsBffr. the bound pipeline is null in weapon mode,
  // which never prunes.
  boundTables: Map<number, Float32Array>
  boundSource: Pick<TargetGpuState, 'stats' | 'mainEchoBuffs' | 'setConstLut'>
  boundPipeline: GPUComputePipeline | null

  // reusable per-job uniform/context buffer
  contextReuse: ReusableBuffer

  // reusable output/readback buffers
  candRs: ReusableBuffer
  candRdbcRs: ReusableBuffer
  candInlineRs: ReusableBuffer
  comboRs: ReusableBuffer

  // recreate the cached bind group only when a bound buffer changes.
  bindGroup: GPUBindGroup | null
  bindGroupBuffer: {
    context: GPUBuffer | null
    constraints: GPUBuffer | null
    candidates: GPUBuffer | null
    comboIndexMap: GPUBuffer | null
    comboRows: GPUBuffer | null
  }

  // tracks which locked-main layout is currently uploaded to comboMapBox and costLayoutBuf
  actLockMaiok: number

  // weapon search state (only set when the static payload includes overlays).
  // weaponMode swaps in the weapon pipeline + a 14-binding bind group that adds
  // the overlay storage buffer and the weapon-meta uniform.
  weaponMode: boolean
  weaponCount: number
  lowMemory: boolean
  weaponOverlayBuf: GPUBuffer | null
  weaponMetaBuf: GPUBuffer | null
}

// minimal payload slice needed after initialization
type TgtGpuRtPay = Pick<
    TargetGpuState,
    | 'context'
    | 'costs'
    | 'comboN'
    | 'comboK'
    | 'totalCombos'
    | 'comboIndexMap'
    | 'comboBinom'
    | 'lockMainReq'
    | 'lockMainCands'
>

// packed candidate rank layout:
// upper bits store which of the 5 combo positions is the chosen main echo,
// lower bits store the combinadic rank
const MAINPOSSHFT = 29
const MAINPOSMASK = 0x7
const RANK_MASK = 0x1FFFFFFF

// context combo count is limited by the packed rank field width
const MAX_CTX_COMBOS = RANK_MASK + 1

// cached target pipelines, one per resonator and archetype (see specOf)
const cachedPipelines = new Map<string, Promise<GPUComputePipeline>>()
let cachedLayout: GPUBindGroupLayout | null = null

// cached weapon-search pipeline + its 14-binding layout
let cachedWpnPipeline: GPUComputePipeline | null = null
let cachedWpnLayout: GPUBindGroupLayout | null = null

// theory explicit batches use one combo per thread. inventory amortizes
// combinadic unranking across CYCLES_PER_CALL; both emit every combination.
let cachedBatchPipeline: GPUComputePipeline | null = null
let cachedWpnBatchPipeline: GPUComputePipeline | null = null

// the batch pipeline matching the active mode (weapon or plain), reusing the
// same bind-group layout as the default-cycle pipeline.
async function getBatchPipeline(
    device: GPUDevice,
    weaponMode: boolean,
): Promise<GPUComputePipeline> {
  if (weaponMode) {
    if (!cachedWpnBatchPipeline) {
      const { layout } = await getWeaponPipeline(device)
      cachedWpnBatchPipeline = await mkChckCmptPp({
        device,
        label: 'optimizer-weapon-pipeline-batch',
        layout,
        code: weaponShaderCode,
        constants: { CYCLES_PER_INVOCATION: LEGACY_BATCH_CYCLES },
      })
    }
    return cachedWpnBatchPipeline
  }
  if (!cachedBatchPipeline) {
    const layout = await getTargetLayout(device)
    cachedBatchPipeline = await mkChckCmptPp({
      device,
      label: 'optimizer-target-pipeline-batch',
      layout,
      code: targetShaderCode,
      constants: { CYCLES_PER_INVOCATION: LEGACY_BATCH_CYCLES },
    })
  }
  return cachedBatchPipeline
}

// lazily compile and cache the weapon-search shader pipeline. its layout is the
// target layout plus bindings 12 (weapon meta uniform) and 13 (overlays).
async function getWeaponPipeline(device: GPUDevice): Promise<{ layout: GPUBindGroupLayout; pipeline: GPUComputePipeline }> {
  if (cachedWpnPipeline && cachedWpnLayout) {
    return { layout: cachedWpnLayout, pipeline: cachedWpnPipeline }
  }

  cachedWpnLayout = await mkChckBindGr(device, 'optimizer-weapon-layout', [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 11, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 12, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    // weapon overlays are a uniform (not storage) so the layout stays within the
    // 10 storage-buffer per-stage limit.
    { binding: 13, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
  ])

  cachedWpnPipeline = await mkChckCmptPp({
    device,
    label: 'optimizer-weapon-pipeline',
    layout: cachedWpnLayout,
    code: weaponShaderCode,
  })

  return { layout: cachedWpnLayout, pipeline: cachedWpnPipeline }
}

const jobFrames = new WeakMap<TgtGpuSttcSt, TgtGpuSttcSt[]>()
// the run's best top-k floor so far, carried across this worker's jobs
let runFloor = { runId: undefined as number | undefined, value: 0 }
function destroyJobBuffers(state: TgtGpuSttcSt) {
  destroyBuffer(state.contextReuse); destroyBuffer(state.candRs); destroyBuffer(state.candRdbcRs)
  destroyBuffer(state.candInlineRs); destroyBuffer(state.comboRs)
}
function targetJobFrame(state: TgtGpuSttcSt, slot: number): TgtGpuSttcSt {
  if (slot === 0) return state
  let frames = jobFrames.get(state)
  if (!frames) { frames = []; jobFrames.set(state, frames) }
  let frame = frames[slot - 1]
  if (!frame) {
    const layout = costLayoutFor(state, state.actLockMaiok)
    frame = { ...state, comboMapBox: makeStoreBuffer(state.device, packIndexMap(layout, state.mainClasses)),
      costLayoutBuf: makeCostLayoutBuffer(state.device, layout),
      echoSttsBffr: makeStoreBuffer(state.device, state.weaponMode
        ? state.boundSource.stats
        : withBoundTable(state.boundSource.stats, boundTableFor(state, state.actLockMaiok))),
      contextReuse: { buffer: null, size: 0 }, candRs: { buffer: null, size: 0 }, candRdbcRs: { buffer: null, size: 0 },
      candInlineRs: { buffer: null, size: 0 }, comboRs: { buffer: null, size: 0 },
      bindGroup: null, bindGroupBuffer: { context: null, constraints: null, candidates: null, comboIndexMap: null, comboRows: null },
    }
    frames[slot - 1] = frame
  }
  return frame
}

// each worker keeps the buffers for one initialized target payload.
const targetGpuSession = new GpuResourceSession<TgtGpuSttcSt>((state) => {
  destroyJobBuffers(state)
  for (const frame of jobFrames.get(state) ?? []) {
    destroyJobBuffers(frame); frame.comboMapBox.destroy(); frame.costLayoutBuf.destroy(); frame.echoSttsBffr.destroy()
  }

  state.echoSttsBffr.destroy()
  state.setCnstLutns.destroy()
  state.echoSetsBffr.destroy()
  state.comboMapBox.destroy()
  state.echoCstsBffr.destroy()
  state.mainEchoBuff.destroy()
  state.statCstrsBsy.destroy()
  state.echoKindIdrr.destroy()
  state.cmbBnmBffr.destroy()
  state.costLayoutBuf.destroy()
  state.weaponOverlayBuf?.destroy()
  state.weaponMetaBuf?.destroy()
})

// pipeline overrides that let the driver strip other resonators' branches.
// the theory batch pipeline compiles without them and keeps the runtime reads.
interface TargetPipelineSpec {
  charId: number
  archetype: number
}

function specOf(context: Float32Array): TargetPipelineSpec {
  const meta0 = new Uint32Array(context.buffer, context.byteOffset, context.length)[META0]!
  return { charId: meta0 & 0xfff, archetype: context[ARCHETYPE]! }
}

async function getTargetLayout(device: GPUDevice): Promise<GPUBindGroupLayout> {
  // layout must match the bindings declared in the target shader
  cachedLayout ??= await mkChckBindGr(device, 'optimizer-target-layout', [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 11, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 12, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
  ])
  return cachedLayout
}

// lazily compile and cache the target pipeline for one spec; bound selects the
// tile bound entry point, compiled with constraints off
async function getPipeline(
    device: GPUDevice,
    spec?: TargetPipelineSpec,
    bound = false,
): Promise<{ layout: GPUBindGroupLayout; pipeline: GPUComputePipeline }> {
  const layout = await getTargetLayout(device)
  const key = `${spec ? `${spec.charId}:${spec.archetype}` : 'generic'}${bound ? ':bound' : ''}`
  let pending = cachedPipelines.get(key)
  if (!pending) {
    pending = mkChckCmptPp({
      device,
      label: `optimizer-target-pipeline:${key}`,
      layout,
      code: targetShaderCode,
      ...(bound ? { entryPoint: 'bound' } : {}),
      constants: {
        ...(spec ? { CHAR_ID: spec.charId, ARCHETYPE: spec.archetype } : {}),
        ...(bound ? { BOUND_PASS: 1 } : {}),
      },
    })
    // a failed compile must not poison the cache
    pending.catch(() => cachedPipelines.delete(key))
    cachedPipelines.set(key, pending)
  }
  return { layout, pipeline: await pending }
}

// destroy one reusable buffer wrapper and reset it
function destroyBuffer(reuse: ReusableBuffer): void {
  reuse.buffer?.destroy()
  reuse.buffer = null
  reuse.size = 0
}

// destroy all current target gpu resources before reinitializing with another payload
function dstrTgtGpuSt(): void {
  targetGpuSession.dispose()
}

// echoes with identical main-echo rows share a class so the shader scores each
// distinct main once per combo. class 0 is the all-zero row; past 62 distinct
// rows the rest get NO_MAIN_CLASS (63) and are always scored.
const NO_MAIN_CLASS = 63
function mkMainClasses(mainEchoBuffs: ArrayLike<number>, echoCount: number): Uint8Array {
  const classes = new Uint8Array(echoCount)
  const byRow = new Map<string, number>()
  for (let echo = 0; echo < echoCount; echo += 1) {
    const row = Array.from({ length: MAIN_BUFF_LEN }, (_, slot) => mainEchoBuffs[echo * MAIN_BUFF_LEN + slot] ?? 0)
    const key = row.every((value) => value === 0) ? '0' : row.join(',')
    let cls = key === '0' ? 0 : byRow.get(key)
    if (cls === undefined) {
      cls = byRow.size + 1 < NO_MAIN_CLASS ? byRow.size + 1 : NO_MAIN_CLASS
      byRow.set(key, cls)
    }
    classes[echo] = cls
  }
  return classes
}

// the index map the shader reads: echo index in the low 16 bits, main class above
function packIndexMap(layout: CostLayout, classes: Uint8Array): Int32Array {
  return layout.indexMap.map((echo) => echo | ((classes[echo] ?? NO_MAIN_CLASS) << 16))
}

// the cost layout for one locked main (-1 when unlocked), cached per payload
function costLayoutFor(state: TgtGpuSttcSt, lockedIndex: number): CostLayout {
  let layout = state.costLayouts.get(lockedIndex)
  if (!layout) {
    layout = mkCostLayout(state.payload.costs, state.payload.comboK, lockedIndex, MAX_ECHO_COST, state.payload.comboBinom)
    state.costLayouts.set(lockedIndex, layout)
  }
  return layout
}

// the tile bound tables follow the layout's index map, so each lock has its own
function boundTableFor(state: TgtGpuSttcSt, lockedIndex: number): Float32Array {
  let table = state.boundTables.get(lockedIndex)
  if (!table) {
    const { stats, mainEchoBuffs, setConstLut } = state.boundSource
    table = mkBoundData(costLayoutFor(state, lockedIndex), stats, mainEchoBuffs, setConstLut)
    state.boundTables.set(lockedIndex, table)
  }
  return table
}

// echo stat rows with the tile bound table appended, as the shader reads them
function withBoundTable(stats: Float32Array, table: Float32Array): Float32Array {
  const out = new Float32Array(stats.length + table.length)
  out.set(stats)
  out.set(table, stats.length)
  return out
}

function makeCostLayoutBuffer(device: GPUDevice, layout: CostLayout): GPUBuffer {
  const buffer = device.createBuffer({
    size: layout.uniform.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, toGpuPldView(layout.uniform))
  return buffer
}

// create or reuse the bind group for the currently active job buffers
function getBindGroup(
    state: TgtGpuSttcSt,
    candidateBuffer: GPUBuffer,
    contextBuffer: GPUBuffer,
    statCstrsBff: GPUBuffer,
    comboBuffer: GPUBuffer,
): GPUBindGroup {
  const ndsRcrt =
      !state.bindGroup ||
      state.bindGroupBuffer.context !== contextBuffer ||
      state.bindGroupBuffer.constraints !== statCstrsBff ||
      state.bindGroupBuffer.candidates !== candidateBuffer ||
      state.bindGroupBuffer.comboIndexMap !== state.comboMapBox ||
      state.bindGroupBuffer.comboRows !== comboBuffer

  if (!ndsRcrt) {
    return state.bindGroup as GPUBindGroup
  }

  const entries: GPUBindGroupEntry[] = [
    // 0: encoded echo stat rows
    { binding: 0, resource: { buffer: state.echoSttsBffr } },

    // 1: set lookup table
    { binding: 1, resource: { buffer: state.setCnstLutns } },

    // 2: set id per echo
    { binding: 2, resource: { buffer: state.echoSetsBffr } },

    // 3: combo index map
    { binding: 3, resource: { buffer: state.comboMapBox } },

    // 4: per-job patched context
    { binding: 4, resource: { buffer: contextBuffer } },

    // 5: echo costs
    { binding: 5, resource: { buffer: state.echoCstsBffr } },

    // 6: main echo bonus rows
    { binding: 6, resource: { buffer: state.mainEchoBuff } },

    // 7: constraints uniform
    { binding: 7, resource: { buffer: statCstrsBff } },

    // 8: echo kind ids
    { binding: 8, resource: { buffer: state.echoKindIdrr } },

    // 9: output candidate buffer
    { binding: 9, resource: { buffer: candidateBuffer } },

    // 10: combinadic binomial table
    { binding: 10, resource: { buffer: state.cmbBnmBffr } },

    // 11: explicit combo rows for theory gpu batch mode
    { binding: 11, resource: { buffer: comboBuffer } },
  ]

  // weapon mode adds the meta uniform (12) and overlay storage (13); the
  // target layout binds the cost-legal enumeration layout at 12 instead
  if (state.weaponMode && state.weaponMetaBuf && state.weaponOverlayBuf) {
    entries.push(
        { binding: 12, resource: { buffer: state.weaponMetaBuf } },
        { binding: 13, resource: { buffer: state.weaponOverlayBuf } },
    )
  } else {
    entries.push({ binding: 12, resource: { buffer: state.costLayoutBuf } })
  }

  state.bindGroup = state.device.createBindGroup({
    label: state.weaponMode ? 'optimizer-weapon-bind-group' : 'optimizer-target-bind-group',
    layout: state.layout,
    entries,
  })

  state.bindGroupBuffer = {
    context: contextBuffer,
    constraints: statCstrsBff,
    candidates: candidateBuffer,
    comboIndexMap: state.comboMapBox,
    comboRows: comboBuffer,
  }

  return state.bindGroup
}

// state guard used by execution functions
function ensTgtGpuStt(): TgtGpuSttcSt {
  if (!targetGpuSession.current) {
    throw new Error('Target GPU worker state has not been initialized')
  }

  return targetGpuSession.current
}

// initialize persistent target-gpu resources for one static payload
export async function initTgtGpu(payload: TargetGpuState): Promise<void> {
  dstrTgtGpuSt()

  const device = await getGpuDevice()

  // weapon search swaps in the weapon pipeline + overlay/meta buffers when the
  // static payload includes overlays; otherwise the plain target pipeline runs.
  const weaponCount = payload.weaponOverlays && (payload.weaponCount ?? 0) > 0
      ? (payload.weaponCount ?? 0)
      : 0
  const weaponMode = weaponCount > 0
  const { layout, pipeline } = weaponMode
      ? await getWeaponPipeline(device)
      : await getPipeline(device, specOf(payload.context))
  const boundPipeline = weaponMode ? null : (await getPipeline(device, specOf(payload.context), true)).pipeline

  // weapon overlays live in a fixed-size uniform buffer (128 vec4s == 32 weapons
  // x 16 floats == 2048 bytes), matching the shader's array<vec4<f32>, 128>.
  const weaponOverlayBuf = weaponMode && payload.weaponOverlays
      ? (() => {
        const buffer = device.createBuffer({
          size: 128 * 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
        device.queue.writeBuffer(buffer, 0, toGpuPldView(payload.weaponOverlays))
        return buffer
      })()
      : null
  const weaponMetaBuf = weaponMode
      ? (() => {
        const buffer = device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
        device.queue.writeBuffer(buffer, 0, new Uint32Array([weaponCount, WEAPON_OVERLAY_STRIDE, 0, 0]))
        return buffer
      })()
      : null

  const lockedIndex = payload.lockMainReq ? (payload.lockMainCands[0] ?? -1) : -1
  const costLayout = mkCostLayout(payload.costs, payload.comboK, lockedIndex, MAX_ECHO_COST, payload.comboBinom)
  if (payload.costs.length > 0xFFFF) throw new Error('Target GPU index map packs echo indices into 16 bits')
  const mainClasses = mkMainClasses(payload.mainEchoBuffs, payload.costs.length)
  const boundTable = mkBoundData(costLayout, payload.stats, payload.mainEchoBuffs, payload.setConstLut)

  targetGpuSession.current = {
    device,
    layout,
    pipeline,

    // keep only the runtime slice needed for later jobs
    payload: {
      context: payload.context,
      costs: payload.costs,
      comboN: payload.comboN,
      comboK: payload.comboK,
      totalCombos: payload.totalCombos,
      comboIndexMap: payload.comboIndexMap,
      comboBinom: payload.comboBinom,
      lockMainReq: payload.lockMainReq,
      lockMainCands: payload.lockMainCands,
    },

    // static buffers uploaded once
    echoSttsBffr: makeStoreBuffer(device, weaponMode ? payload.stats : withBoundTable(payload.stats, boundTable)),
    setCnstLutns: makeStoreBuffer(device, payload.setConstLut),
    echoSetsBffr: makeStoreBuffer(device, payload.sets),
    comboMapBox: makeStoreBuffer(device, packIndexMap(costLayout, mainClasses)),
    mainClasses,
    costLayoutBuf: makeCostLayoutBuffer(device, costLayout),
    costLayouts: new Map([[lockedIndex, costLayout]]),
    boundTables: new Map([[lockedIndex, boundTable]]),
    boundSource: { stats: payload.stats, mainEchoBuffs: payload.mainEchoBuffs, setConstLut: payload.setConstLut },
    boundPipeline,

    // reused per-job context uniform
    contextReuse: { buffer: null, size: 0 },

    echoCstsBffr: makeStoreBuffer(device, payload.costs),
    mainEchoBuff: makeStoreBuffer(device, payload.mainEchoBuffs),

    // constraints live in a uniform buffer
    statCstrsBsy: (() => {
      const buffer = device.createBuffer({
        size: Math.max(16, payload.constraints.byteLength),
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      if (payload.constraints.byteLength > 0) {
        device.queue.writeBuffer(buffer, 0, toGpuPldView(payload.constraints))
      }

      return buffer
    })(),

    echoKindIdrr: makeStoreBuffer(device, payload.kinds),
    cmbBnmBffr: makeStoreBuffer(device, payload.comboBinom),

    // reusable candidate output/readback
    candRs: { buffer: null, size: 0 },
    candRdbcRs: { buffer: null, size: 0 },
    candInlineRs: { buffer: null, size: 0 },
    comboRs: { buffer: null, size: 0 },

    bindGroup: null,
    bindGroupBuffer: {
      context: null,
      constraints: null,
      candidates: null,
      comboIndexMap: null,
      comboRows: null,
    },

    // track which locked-main layout the comboMapBox buffer currently represents
    actLockMaiok: lockedIndex,

    weaponMode,
    weaponCount,
    lowMemory: payload.lowMmryMode ?? false,
    weaponOverlayBuf,
    weaponMetaBuf,
  }
}

// run one target-gpu job, possibly split into multiple subjobs if comboCount exceeds
// what can be represented inside one packed context rank span
async function runTgtGpuJobFrame(
    job: TgtGpuJobPay,
    hooks: TgtGpuRunHks,
    state: TgtGpuSttcSt,
): Promise<OptTgtGpuRsl[]> {

  if (hooks.isCancelled?.() || job.comboCount <= 0) {
    return []
  }

  // collect results across all subjobs, then sort/limit at the end
  const vrllCllc = new OptResultSet(job.jobResultLimit)

  const costLayout = costLayoutFor(state, job.lockMainIdx)

  // if this job uses a different locked echo than the currently uploaded one,
  // swap in its cost-sorted index map and enumeration layout first
  if (state.actLockMaiok !== job.lockMainIdx) {
    state.device.queue.writeBuffer(state.comboMapBox, 0, toGpuPldView(packIndexMap(costLayout, state.mainClasses)))
    state.device.queue.writeBuffer(state.costLayoutBuf, 0, toGpuPldView(costLayout.uniform))
    if (state.boundPipeline) {
      state.device.queue.writeBuffer(state.echoSttsBffr, state.boundSource.stats.byteLength,
        toGpuPldView(boundTableFor(state, job.lockMainIdx)))
    }
    state.actLockMaiok = job.lockMainIdx
  }

  const comboIds = new Int32Array(5)
  let remaining = job.comboCount
  let subJobStart = job.comboStart

  while (remaining > 0) {
    if (hooks.isCancelled?.()) {
      return vrllCllc.sorted(job.jobResultLimit)
    }
    // each subjob is capped so combo rank still fits in the packed gpu candidate format
    const subJobCount = Math.min(remaining, MAX_CTX_COMBOS)

    // patch the base context with this subjob's combo span and locked-main choice
    const ptchCtx = ptchTgtCtxFo({
      baseContext: state.payload.context,
      comboN: costLayout.indexMap.length,
      comboK: costLayout.comboK,
      comboCount: subJobCount,
      comboBaseIndex: subJobStart,
      lockEchoIdx: job.lockMainIdx,
      candidateFloor: hooks.floor?.() ?? 0,
    })

    const contextBuffer = ensureGpuBuffer(
        state.device,
        state.contextReuse,
        ptchCtx.byteLength,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    )

    // workgroup/candidate sizing for this subjob
    const callCnt = Math.ceil(subJobCount / CYCLES_PER_CALL)
    const wgCnt = Math.ceil(callCnt / OPT_WG_SIZE)
    const candCnt = subJobCount

    const candidateBuffer = ensureGpuBuffer(
        state.device,
        state.candRs,
        GPU_APPEND_HEADER + candCnt * GPU_CAND_STRIDE,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    )

    const comboBuffer = ensureGpuBuffer(
        state.device,
        state.comboRs,
        4,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    )

    const bindGroup = getBindGroup(state, candidateBuffer, contextBuffer, state.statCstrsBsy, comboBuffer)

    const submission = state.device.createCommandEncoder()
    // reset the append count
    submission.clearBuffer(candidateBuffer, 0, GPU_APPEND_HEADER)
    await dispCmptPass({
      encoder: submission,
      device: state.device,
      pipeline: state.pipeline,
      bindGroup,
      wrkgCnt: wgCnt,
      // one bound workgroup per scoring workgroup
      ...(state.boundPipeline ? { prePass: { pipeline: state.boundPipeline, wrkgCnt: wgCnt } } : {}),
      bfrDsptBtch: (wgBase) => {
        ptchTgtCtxDi(ptchCtx, wgBase)
        state.device.queue.writeBuffer(contextBuffer, 0, toGpuPldView(ptchCtx))
      },
    })
    // read candidates back to cpu
    const { results: candidates } = await readAppendedCands(
        state.device,
        candidateBuffer,
        candCnt,
        GPU_APPEND_INLINE,
        state.candInlineRs,
        state.candRdbcRs,
        Math.max(1, job.jobResultLimit * GPU_DECODE_OVERSAMPLE),
        submission,
    )

    if (hooks.isCancelled?.()) {
      return vrllCllc.sorted(job.jobResultLimit)
    }

    sortCnddByDm(candidates)

    // only unrank an oversampled prefix of the gpu candidates
    const subJobCandLm = Math.max(1, job.jobResultLimit * GPU_REDUCE_K)
    let pushed = 0

    for (const candidate of candidates) {
      const packedRank = candidate.rank >>> 0
      const mainPos = (packedRank >>> MAINPOSSHFT) & MAINPOSMASK
      const comboRank = packedRank & RANK_MASK

      // decode the combo back into concrete echo indices
      nrnkCostCombo(comboRank + subJobStart, costLayout, state.payload.comboBinom, comboIds)

      const mainIndex = comboIds[mainPos] ?? -1
      vrllCllc.pushRdrdCmb(candidate.damage, comboIds, mainIndex)

      pushed += 1
      if (pushed >= subJobCandLm) {
        break
      }
    }
    remaining -= subJobCount
    subJobStart += subJobCount
  }

  return vrllCllc.sorted(job.jobResultLimit)
}

// run one explicit combo batch on the target gpu evaluator.
// the theory producer prunes legal combos. this path reads them from a
// transferred row buffer.
async function runTgtGpuBtcFrame(
    job: TgtGpuBtcPay,
    hooks: TgtGpuRunHks,
    state: TgtGpuSttcSt,
): Promise<OptTgtGpuRsl[]> {

  if (hooks.isCancelled?.() || job.comboCount <= 0) {
    return []
  }
  const ptchCtx = ptchTgtCtxFo({
    baseContext: state.payload.context,
    comboN: state.payload.comboN,
    comboK: 5,
    comboCount: job.comboCount,
    comboBaseIndex: 0,
    lockEchoIdx: job.lockMainIdx,
    comboMode: GPU_COMBO_MODE_BATCH,
  })

  const contextBuffer = ensureGpuBuffer(
      state.device,
      state.contextReuse,
      ptchCtx.byteLength,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )

  // theory runs one combo per thread (BATCH_CYCLES), so dispatch enough threads
  // to cover every combo and emit one candidate each. this must match the
  // CYCLES_PER_INVOCATION override compiled into the batch pipeline below.
  const batchPipeline = await getBatchPipeline(state.device, state.weaponMode)
  const wgCnt = Math.ceil(job.comboCount / Math.max(1, OPT_WG_SIZE * LEGACY_BATCH_CYCLES))
  const candCnt = job.comboCount
  if (candCnt <= 0) {
    return []
  }

  // the target shader's batch items follow the append header; the weapon
  // shader writes a bare candidate array
  const itemOffset = state.weaponMode ? 0 : GPU_APPEND_HEADER
  const candidateBuffer = ensureGpuBuffer(
      state.device,
      state.candRs,
      itemOffset + candCnt * GPU_CAND_STRIDE,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  )

  const comboBuffer = writeGpuBffr(
      state.device,
      state.comboRs,
      job.combosBatch,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  )

  const bindGroup = getBindGroup(state, candidateBuffer, contextBuffer, state.statCstrsBsy, comboBuffer)

  const submission = state.device.createCommandEncoder()
  await dispCmptPass({
    encoder: submission,
    device: state.device,
    pipeline: batchPipeline,
    bindGroup,
    wrkgCnt: wgCnt,
    bfrDsptBtch: (wgBase) => {
      ptchTgtCtxDi(ptchCtx, wgBase)
      state.device.queue.writeBuffer(contextBuffer, 0, toGpuPldView(ptchCtx))
    },
  })
  const { results: candidates } = await readCandBffr(
      state.device,
      candidateBuffer,
      candCnt,
      state.candRdbcRs,
      Math.max(1, job.jobResultLimit * GPU_DECODE_OVERSAMPLE),
      submission,
      itemOffset,
  )

  if (hooks.isCancelled?.()) {
    return []
  }

  sortCnddByDm(candidates)

  const collector = new OptResultSet(job.jobResultLimit)
  const comboIds = new Int32Array(5)
  const candLmt = Math.max(1, job.jobResultLimit * GPU_REDUCE_K)
  let pushed = 0

  for (const candidate of candidates) {
    const packedRank = candidate.rank >>> 0
    // weapon mode packs the weapon index in the high bits and pins the main at
    // slot 0; the plain path packs the main position in the top 3 bits.
    const mainPos = state.weaponMode ? 0 : ((packedRank >>> MAINPOSSHFT) & MAINPOSMASK)
    const weapon = state.weaponMode ? ((packedRank >>> WEAPON_INDEX_SHIFT) & WEAPON_BIT_MASK) : -1
    const comboIndex = state.weaponMode ? (packedRank & WEAPON_RANK_MASK) : (packedRank & RANK_MASK)
    if (comboIndex >= job.comboCount) {
      continue
    }

    const base = comboIndex * 5
    comboIds[0] = job.combosBatch[base] ?? -1
    comboIds[1] = job.combosBatch[base + 1] ?? -1
    comboIds[2] = job.combosBatch[base + 2] ?? -1
    comboIds[3] = job.combosBatch[base + 3] ?? -1
    comboIds[4] = job.combosBatch[base + 4] ?? -1

    const mainIndex = comboIds[mainPos] ?? -1
    collector.pushRdrdCmb(candidate.damage, comboIds, mainIndex, weapon)

    pushed += 1
    if (pushed >= candLmt) {
      break
    }
  }
  return collector.sorted(job.jobResultLimit)
}


// target batches use separate upload, output, and readback buffers.
// keep batch scheduling within the target runner.
async function runTargetGpu(job: TgtGpuJobPay | TgtGpuBtcPay, hooks: TgtGpuRunHks): Promise<OptTgtGpuRsl[]> {
  if (job.comboCount <= 0) return []
  const state = ensTgtGpuStt(), collector = new OptResultSet(job.jobResultLimit, state.lowMemory)
  const explicit = 'combosBatch' in job
  const width = OPT_WG_SIZE * (explicit ? LEGACY_BATCH_CYCLES : CYCLES_PER_CALL)
  const depth = gpuPipelineDepth(state.lowMemory)
  const chunk = targetGpuFrameCombos(job.comboCount, width, state.lowMemory,
    state.device.limits.maxStorageBufferBindingSize, state.device.limits.maxBufferSize, explicit)
  const slots = Math.min(depth, Math.ceil(job.comboCount / chunk))
  if (runFloor.runId !== hooks.runId) runFloor = { runId: hooks.runId, value: 0 }
  // inside one inventory job every combo is a distinct echo set, so the job's
  // k-th best is exact. sets repeat across locked-main jobs, but a floor from
  // any job still names k distinct sets at or above it, so the run keeps the
  // highest one.
  const floored = !explicit
  const floor = () => floored ? Math.max(runFloor.value, collector.floor) : 0
  const frameHooks: TgtGpuRunHks = { ...hooks, floor }
  let next = 0
  // with no floor yet, every candidate of the first frames reads back. score a
  // small priming frame alone first so the frames after it filter on the GPU.
  if (floored && floor() === 0 && job.comboCount > chunk && !hooks.isCancelled?.()) {
    next = Math.min(TARGET_GPU_PRIME_COMBOS, chunk)
    const results = await runTgtGpuJobFrame({ ...job as TgtGpuJobPay, comboCount: next },
      frameHooks, targetJobFrame(state, 0))
    for (const result of results) collector.push(result)
  }
  const outcomes = await Promise.allSettled(Array.from({ length: slots }, async (_, slot) => {
    const frame = targetJobFrame(state, slot)
    while (next < job.comboCount && !hooks.isCancelled?.()) {
      const offset = next, count = Math.min(chunk, job.comboCount - offset)
      next += count
      const results = 'combosBatch' in job
        ? await runTgtGpuBtcFrame({ ...job, comboCount: count,
          combosBatch: job.combosBatch.subarray(offset * 5, (offset + count) * 5) }, frameHooks, frame)
        : await runTgtGpuJobFrame({ ...job, comboStart: job.comboStart + offset, comboCount: count }, frameHooks, frame)
      for (const result of results) collector.push(result)
    }
  }))
  const failed = outcomes.find(outcome => outcome.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  if (floored) runFloor.value = Math.max(runFloor.value, collector.floor)
  return collector.sorted()
}

export async function runTgtGpuJob(job: TgtGpuJobPay, hooks: TgtGpuRunHks = {}): Promise<OptTgtGpuRsl[]> {
  return runTargetGpu(job, hooks)
}
export async function runTgtGpuBtc(job: TgtGpuBtcPay, hooks: TgtGpuRunHks = {}): Promise<OptTgtGpuRsl[]> {
  return runTargetGpu(job, hooks)
}
