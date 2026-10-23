/*
  Author: Runor Ewhro
  description: builds and caches bounded, device-owned WebGPU pipeline variants
               for generated rotation scorers.
*/
import rotShdrCode from '@/engine/optimizer/shaders/rotation.wgsl?raw'
import costCursorCode from '@/engine/optimizer/shaders/costCursor.wgsl?raw'
import { withOptimizerDamageSpec } from '@/engine/optimizer/config/shaders'
import { mkChckBindGr, mkChckCmptPp } from '@/engine/optimizer/gpu/common'
import { portableShader } from '@/engine/rotation/portable/gpu'
import { NATIVE_ROTATION_CYCLES } from '@/engine/search/layout/constants'
import { SHADER_PIPELINE_CACHE_LIMIT, TARGET_TILE_WORDS } from '../config/constants'
import type { PckdRotXctnP } from '@/engine/optimizer/types'

interface Pipelines { layout: GPUBindGroupLayout; pipeline: GPUComputePipeline }
const caches = new WeakMap<GPUDevice, Map<string, Promise<Pipelines>>>()
const sources = new WeakMap<PckdRotXctnP, string>()

async function prepare(device: GPUDevice, payload: PckdRotXctnP): Promise<Pipelines> {
  let source = sources.get(payload)
  if (source === undefined) { source = portableShader(payload); sources.set(payload, source) }
  let cache = caches.get(device)
  if (!cache) { cache = new Map(); caches.set(device, cache) }
  const existing = cache.get(source)
  if (existing) return existing
  const pending = (async () => {
    const uniform = new Set([4, 7, 12, 13])
    const layout = await mkChckBindGr(device, 'optimizer-rotation-layout', Array.from({ length: 14 }, (_, binding) => ({
      binding, visibility: GPUShaderStage.COMPUTE,
      buffer: { type: binding === 9 ? 'storage' as const : uniform.has(binding) ? 'uniform' as const : 'read-only-storage' as const },
    })))
    // template bindings + the generated scorer + the cost-legal cursor
    let code = withOptimizerDamageSpec(rotShdrCode) + source + costCursorCode
    // generated kernels append candidates behind the shared append header
    const plain = '@group(0) @binding(9) var<storage, read_write> candidates: array<Candidate>;'
    if (!code.includes(plain)) throw new Error('Rotation shader template is missing its candidate binding')
    code = code.replace(plain, `const TILE_WORDS: u32 = ${TARGET_TILE_WORDS}u;
struct CandidateOut { count: atomic<u32>, _pad: u32, tiles: array<atomic<u32>, TILE_WORDS>, items: array<Candidate>, };
@group(0) @binding(9) var<storage, read_write> candidates: CandidateOut;`)
    const pipeline = await mkChckCmptPp({ device, label: 'optimizer-rotation-pipeline', layout, code,
      constants: { CYCLES_PER_INVOCATION: NATIVE_ROTATION_CYCLES },
    })
    return { layout, pipeline }
  })()
  // cache exact generated source per device; different rotations never share a pipeline
  if (cache.size >= SHADER_PIPELINE_CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(source, pending)
  try { return await pending } catch (error) { cache.delete(source); throw error }
}
export async function getRotGpuPpl(device: GPUDevice, payload: PckdRotXctnP) { return prepare(device, payload) }
