/*
  Author: Runor Ewhro
  description: derives memory-bounded GPU frames and adaptive CPU/GPU batch
               sizes from per-run scoring feedback.
*/
import {
  ADAPTIVE_BATCH_MAX_GROWTH,
  ADAPTIVE_BATCH_MIN_RATIO,
  ADAPTIVE_BATCH_SMOOTHING,
  CPU_JOB_TARGET_MS,
  CPU_THEORY_JOB,
  CPU_THEORY_JOB_MAX,
  CPU_THEORY_JOB_MIN,
  GPU_APPEND_HEADER,
  GPU_JOB_TARGET_MS,
  GPU_PIPELINE_DEPTH,
  NATIVE_GPU_JOB_INITIAL,
  NATIVE_GPU_JOB_MAX,
  NATIVE_GPU_JOB_MIN,
  LOW_MEMORY_BATCH_DIVISOR,
  TARGET_GPU_SUBMISSION_COMBOS,
} from './constants'
import { NATIVE_ROTATION_WORKGROUP_SIZE, NATIVE_ROTATION_CYCLES } from '@/engine/search/layout/constants'

export function gpuPipelineDepth(lowMemory: boolean): number { return lowMemory ? 1 : GPU_PIPELINE_DEPTH }
export function targetGpuFrameCombos(
  comboCount: number,
  width: number,
  lowMemory: boolean,
  maxStorageBufferBindingSize: number,
  maxBufferSize: number,
  explicitCombos = false,
): number {
  // inventory writes one 8-byte candidate per combo. theory also uploads five
  // i32 Echo indices per combo, making its input buffer the tighter limit.
  // candidate buffers also include the append header.
  const bytesPerCombo = explicitCombos ? 20 : 8
  const memoryCap = Math.floor((Math.min(maxStorageBufferBindingSize, maxBufferSize) - GPU_APPEND_HEADER) / bytesPerCombo)
  const requestedCap = Math.floor(TARGET_GPU_SUBMISSION_COMBOS / (lowMemory ? LOW_MEMORY_BATCH_DIVISOR : 1))
  const cap = Math.floor(Math.min(memoryCap, requestedCap) / width) * width
  if (cap < width) throw new Error('GPU candidate buffer cannot hold one target workgroup')
  const depth = gpuPipelineDepth(lowMemory)
  return Math.min(cap, Math.max(width, Math.ceil(comboCount / depth / width) * width))
}
export function rotationGpuBatchSize(lowMemory = false): number {
  return Math.floor(NATIVE_GPU_JOB_INITIAL / (lowMemory ? LOW_MEMORY_BATCH_DIVISOR : 1))
}
// inventory gpu jobs read back only candidates above the floor, so they may
// grow past the theory cap toward a longer per-job target
export function adaptiveTheoryBatch(gpu: boolean, lowMemory: boolean, inventory?: { max: number; targetMs: number }) {
  const divisor = lowMemory ? LOW_MEMORY_BATCH_DIVISOR : 1
  const alignment = gpu ? NATIVE_ROTATION_WORKGROUP_SIZE * NATIVE_ROTATION_CYCLES : 1
  const min = Math.max(alignment, Math.floor((gpu ? NATIVE_GPU_JOB_MIN : CPU_THEORY_JOB_MIN) / divisor))
  const max = Math.max(min, Math.floor((inventory?.max ?? (gpu ? NATIVE_GPU_JOB_MAX : CPU_THEORY_JOB_MAX)) / divisor / alignment) * alignment)
  const targetMs = inventory?.targetMs ?? (gpu ? GPU_JOB_TARGET_MS : CPU_JOB_TARGET_MS)
  let size = Math.max(min, Math.floor((gpu ? NATIVE_GPU_JOB_INITIAL : CPU_THEORY_JOB) / divisor / alignment) * alignment)
  let rate = 0
  return {
    get size() { return size }, max,
    observe(count: number, elapsedMs: number): number {
      if (!(count > 0 && elapsedMs > 0 && Number.isFinite(elapsedMs))) return size
      const sample = count / elapsedMs
      rate = rate ? rate * (1 - ADAPTIVE_BATCH_SMOOTHING) + sample * ADAPTIVE_BATCH_SMOOTHING : sample
      const desired = rate * targetMs
      size = Math.max(min, Math.min(max, Math.floor(Math.max(size * ADAPTIVE_BATCH_MIN_RATIO, Math.min(size * ADAPTIVE_BATCH_MAX_GROWTH, desired)) / alignment) * alignment))
      return size
    },
  }
}
