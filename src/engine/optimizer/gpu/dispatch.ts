/*
  Author: Runor Ewhro
  description: dispatches compute work in batches beyond the WebGPU workgroup limit.
*/

import { MAX_DISPATCH_WORKGROUPS } from '../config/constants'

export async function dispCmptPass(options: {
  device: GPUDevice
  pipeline: GPUComputePipeline
  bindGroup: GPUBindGroup
  wrkgCnt: number
  maxWorkgroups?: number
  bfrDsptBtch?: (wgBase: number, batchSize: number) => void | Promise<void>
  /** append a single dispatch to a caller-owned scoring/readback submission. */
  encoder?: GPUCommandEncoder
  /** prepass dispatch writes are visible to the main dispatch in the same pass. */
  prePass?: { pipeline: GPUComputePipeline; wrkgCnt: number }
}): Promise<void> {
  const {
    device,
    pipeline,
    bindGroup,
    wrkgCnt: wrkgCnt,
    bfrDsptBtch: bfrDsptBtch,
  } = options

  // webgpu only allows a limited number of workgroups in one dispatch call.
  // so if the caller requests more than that, split it into multiple dispatches.
  let remaining = wrkgCnt
  let dispatched = 0
  const maxWgPerBatch = Math.max(
      1,
      options.maxWorkgroups ?? MAX_DISPATCH_WORKGROUPS,
  )
  if (options.encoder && wrkgCnt > Math.min(MAX_DISPATCH_WORKGROUPS, maxWgPerBatch)) throw new Error('A shared GPU encoder requires a single dispatch')

  while (remaining > 0) {
    // take the biggest legal chunk for this pass
    const batch = Math.min(remaining, MAX_DISPATCH_WORKGROUPS, maxWgPerBatch)

    await bfrDsptBtch?.(dispatched, batch)

    // create a fresh encoder/pass for this chunk
    const encoder = options.encoder ?? device.createCommandEncoder()
    const pass = encoder.beginComputePass()

    // bind pipeline resources once per batch
    pass.setBindGroup(0, bindGroup)
    if (options.prePass && dispatched === 0) {
      pass.setPipeline(options.prePass.pipeline)
      pass.dispatchWorkgroups(options.prePass.wrkgCnt)
    }
    pass.setPipeline(pipeline)

    // dispatch only this chunk of workgroups
    pass.dispatchWorkgroups(batch)
    pass.end()

    // submit immediately so very large workloads can stream through in pieces
    if (!options.encoder) device.queue.submit([encoder.finish()])

    // subtract the chunk we just launched and continue until done
    remaining -= batch
    dispatched += batch
  }
}
