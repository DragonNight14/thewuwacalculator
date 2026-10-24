/*
  Author: Runor Ewhro
  description: provides shared gpu buffer helpers for upload, reuse,
               validated pipeline creation, and candidate readback.
*/

import { GPU_APPEND_HEADER } from '@/engine/optimizer/config/constants.ts'

export { GPU_APPEND_HEADER }
export const GPU_CAND_STRIDE = 8

// anything that can be directly uploaded into a gpu buffer
export type PldbBffrSrc = ArrayBuffer | ArrayBufferView<ArrayBufferLike>

// small reuse wrapper so callers can keep one gpu buffer alive and resize only when needed
export interface ReusableBuffer {
  buffer: GPUBuffer | null
  size: number
}

// normalize upload input into something queue.writeBuffer accepts cleanly
export function toGpuPldView(data: PldbBffrSrc): ArrayBuffer | ArrayBufferView<ArrayBuffer> {
  if (data instanceof ArrayBuffer) {
    return data
  }

  return data as ArrayBufferView<ArrayBuffer>
}

// create a storage buffer and optionally upload initial contents into it
export function makeStoreBuffer(device: GPUDevice, data: PldbBffrSrc): GPUBuffer {
  const upload = toGpuPldView(data)

  // both branches expose byteLength, this just keeps intent explicit
  const byteLength = upload instanceof ArrayBuffer ? upload.byteLength : upload.byteLength

  // gpu buffers cannot have size 0, so clamp to at least 4 bytes
  const buffer = device.createBuffer({
    size: Math.max(4, byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

  // only upload when there is actual data
  if (byteLength > 0) {
    device.queue.writeBuffer(buffer, 0, upload)
  }

  return buffer
}

// return an existing reusable buffer when large enough, otherwise recreate it
export function ensureGpuBuffer(
    device: GPUDevice,
    reuse: ReusableBuffer,
    neededSize: number,
    usage: GPUBufferUsageFlags,
): GPUBuffer {
  const byteLength = Math.max(4, neededSize)

  // reuse existing allocation if it already satisfies the requested size
  if (reuse.buffer && reuse.size >= byteLength) {
    return reuse.buffer
  }

  // replacing a reusable buffer includes destruction of the old allocation.
  reuse.buffer?.destroy()

  reuse.buffer = device.createBuffer({
    size: byteLength,
    usage,
  })
  reuse.size = byteLength

  return reuse.buffer
}

// ensure a reusable buffer exists, then upload fresh contents into it
export function writeGpuBffr(
    device: GPUDevice,
    reuse: ReusableBuffer,
    data: PldbBffrSrc,
    usage: GPUBufferUsageFlags,
): GPUBuffer {
  const upload = toGpuPldView(data)
  const byteLength = upload instanceof ArrayBuffer ? upload.byteLength : upload.byteLength
  const buffer = ensureGpuBuffer(device, reuse, byteLength, usage)

  if (byteLength > 0) {
    device.queue.writeBuffer(buffer, 0, upload)
  }

  return buffer
}

// turn shader compilation errors into one readable multiline string
function fmtShdrCmplR(label: string, info: GPUCompilationInfo): string | null {
  const errors = info.messages.filter((message) => message.type === 'error')
  if (errors.length === 0) {
    return null
  }

  return errors
      .map((message) => {
        const line = message.lineNum > 0 ? `:${message.lineNum}:${message.linePos}` : ''
        return `${label}${line} ${message.message}`
      })
      .join('\n')
}

// pop the current validation scope and throw if the gpu reported an error
async function popValidRrr(device: GPUDevice, label: string): Promise<void> {
  const error = await device.popErrorScope()
  if (error) {
    throw new Error(`${label}: ${error.message}`)
  }
}

// validate bind group layout creation with scoped error context.
export async function mkChckBindGr(
    device: GPUDevice,
    label: string,
    entries: GPUBindGroupLayoutEntry[],
): Promise<GPUBindGroupLayout> {
  device.pushErrorScope('validation')

  const layout = device.createBindGroupLayout({ label, entries })

  await popValidRrr(device, label)
  return layout
}

// compile a compute shader, surface shader compilation errors, then create a validated pipeline
export async function mkChckCmptPp(options: {
  device: GPUDevice
  label: string
  layout: GPUBindGroupLayout
  code: string
  entryPoint?: string
  // pipeline-override constant values (wgsl `override` declarations), e.g. to
  // compile a lower CYCLES_PER_INVOCATION variant of the same shader.
  constants?: Record<string, number>
}): Promise<GPUComputePipeline> {
  const { device, label, layout, code, entryPoint = 'main', constants } = options

  // create the shader module before reading compiler diagnostics.
  const module = device.createShaderModule({ label: `${label}:shader`, code })

  const info = await module.getCompilationInfo()
  const shaderError = fmtShdrCmplR(label, info)
  if (shaderError) {
    throw new Error(shaderError)
  }

  // wrap pipeline creation in a validation scope so bind/layout mismatches are caught cleanly
  device.pushErrorScope('validation')

  const pipeline = await device.createComputePipelineAsync({
    label,
    layout: device.createPipelineLayout({
      label: `${label}:pipeline-layout`,
      bindGroupLayouts: [layout],
    }),
    compute: {
      module,
      entryPoint,
      ...(constants ? { constants } : {}),
    },
  })

  await popValidRrr(device, label)
  return pipeline
}

// copy a gpu candidate buffer into a cpu-readable staging buffer and decode results
export async function readCandBffr(
    device: GPUDevice,
    candidateBuffer: GPUBuffer,
    candCnt: number,
    reuse: ReusableBuffer = { buffer: null, size: 0 },
    resultLimit?: number,
    submission?: GPUCommandEncoder,
    // byte offset of the first candidate (an appended buffer's 8-byte header)
    srcOffset = 0,
): Promise<{ results: Array<{ damage: number; rank: number }>; reuse: ReusableBuffer }> {
  // each candidate occupies 8 bytes:
  // float32 damage + uint32 rank/index
  const byteLength = candCnt * GPU_CAND_STRIDE

  // reuse the readback buffer across reads.
  const readBuffer = ensureGpuBuffer(
      device,
      reuse,
      byteLength,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  )

  // schedule a copy from the gpu-only candidate buffer into the readable staging buffer
  const encoder = submission ?? device.createCommandEncoder()
  encoder.copyBufferToBuffer(candidateBuffer, srcOffset, readBuffer, 0, byteLength)
  device.queue.submit([encoder.finish()])

  // wait for gpu work to finish and map the buffer for cpu access
  await readBuffer.mapAsync(GPUMapMode.READ)

  const mapped = readBuffer.getMappedRange()
  const results = selectCandidates(mapped, 0, candCnt, resultLimit)
  readBuffer.unmap()

  return { results, reuse }
}

// pick candidates from mapped [damage f32, rank u32] pairs, strongest first
// when a limit applies. empty or invalid slots (damage <= 0) are skipped.
function selectCandidates(
    mapped: ArrayBuffer,
    first: number,
    candCnt: number,
    resultLimit?: number,
): Array<{ damage: number; rank: number }> {
  // same bytes are viewed as both float and uint to decode paired fields
  const floatView = new Float32Array(mapped, first * GPU_CAND_STRIDE, candCnt * 2)
  const uintView = new Uint32Array(mapped, first * GPU_CAND_STRIDE, candCnt * 2)

  const results: Array<{ damage: number; rank: number }> = []

  // select in mapped numeric storage before creating JS objects. large
  // arithmetic batches must not allocate and sort an object per combination.
  if (resultLimit !== undefined && resultLimit < candCnt) {
    const limit = Math.max(1, Math.floor(resultLimit))
    const scores = new Float32Array(limit), ranks = new Uint32Array(limit), order = new Uint32Array(limit)
    let count = 0
    const worse = (a: number, b: number) => scores[a]! < scores[b]! || (scores[a] === scores[b] && order[a]! > order[b]!)
    const swap = (a: number, b: number) => {
      const score = scores[a]!, rank = ranks[a]!, index = order[a]!
      scores[a] = scores[b]!; ranks[a] = ranks[b]!; order[a] = order[b]!
      scores[b] = score; ranks[b] = rank; order[b] = index
    }
    for (let index = 0; index < candCnt; index++) {
      const damage = floatView[index * 2]!
      if (!(damage > 0)) continue
      if (count < limit) {
        let slot = count++
        scores[slot] = damage; ranks[slot] = uintView[index * 2 + 1]!; order[slot] = index
        while (slot > 0) { const parent = (slot - 1) >>> 1; if (!worse(slot, parent)) break; swap(slot, parent); slot = parent }
      } else if (damage > scores[0]!) {
        scores[0] = damage; ranks[0] = uintView[index * 2 + 1]!; order[0] = index
        let slot = 0
        while (slot * 2 + 1 < count) {
          const left = slot * 2 + 1, right = left + 1
          const child = right < count && worse(right, left) ? right : left
          if (!worse(child, slot)) break
          swap(child, slot); slot = child
        }
      }
    }
    const selected = Array.from({ length: count }, (_, index) => index).sort((a, b) => scores[b]! - scores[a]! || order[a]! - order[b]!)
    for (const index of selected) results.push({ damage: scores[index]!, rank: ranks[index]! })
    return results
  }

  for (let index = 0; index < candCnt; index += 1) {
    const base = index * 2
    const damage = floatView[base]

    // empty or invalid candidate slots are ignored
    if (damage <= 0) {
      continue
    }

    results.push({
      damage,
      rank: uintView[base + 1],
    })
  }

  return results
}


// read back a buffer the shader appended into: copy the header and a small
// inline window first, and only copy the rest when the window overflowed.
export async function readAppendedCands(
    device: GPUDevice,
    candidateBuffer: GPUBuffer,
    maxCount: number,
    inlineCount: number,
    inlineReuse: ReusableBuffer,
    overflowReuse: ReusableBuffer,
    resultLimit: number,
    submission: GPUCommandEncoder,
): Promise<{ results: Array<{ damage: number; rank: number }>; count: number }> {
  const window = Math.min(inlineCount, maxCount)
  const inlineBytes = GPU_APPEND_HEADER + window * GPU_CAND_STRIDE
  const inlineBuffer = ensureGpuBuffer(device, inlineReuse, inlineBytes, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ)

  submission.copyBufferToBuffer(candidateBuffer, 0, inlineBuffer, 0, inlineBytes)
  device.queue.submit([submission.finish()])
  await inlineBuffer.mapAsync(GPUMapMode.READ, 0, inlineBytes)

  const mapped = inlineBuffer.getMappedRange(0, inlineBytes)
  const count = Math.min(new Uint32Array(mapped, 0, 1)[0]!, maxCount)
  if (count <= window) {
    const results = selectCandidates(mapped, GPU_APPEND_HEADER / GPU_CAND_STRIDE, count, resultLimit)
    inlineBuffer.unmap()
    return { results, count }
  }
  inlineBuffer.unmap()

  // the floor was too low for this frame: fetch every appended candidate
  const { results } = await readCandBffr(device, candidateBuffer, count, overflowReuse, resultLimit,
    undefined, GPU_APPEND_HEADER)
  return { results, count }
}

// candidates are read back unsorted; sort strongest-first before decoding.
export function sortCnddByDm<T extends { damage: number }>(candidates: T[]): void {
  candidates.sort((left, right) => right.damage - left.damage)
}
