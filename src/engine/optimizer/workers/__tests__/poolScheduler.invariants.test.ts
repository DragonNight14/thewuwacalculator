/*
  Author: Runor Ewhro
  description: verifies optimizer pool generations suppress callbacks retained
               by an invalidated run.
*/

import { expect, it, vi } from 'vitest'
import { OptimizerWorkerPool } from '../poolScheduler'
import type { OptPrgr } from '@/engine/optimizer/types'

it('invalidates callbacks from an earlier optimizer run', () => {
  const pool = new OptimizerWorkerPool()
  const onProgress = vi.fn()
  const first = pool.beginRun({ onProgress })
  const progress = {} as OptPrgr

  first.hooks.onProgress?.(progress)
  expect(onProgress).toHaveBeenCalledOnce()

  const second = pool.beginRun({ onProgress })
  first.hooks.onProgress?.(progress)
  expect(first.isCurrent()).toBe(false)
  expect(first.hooks.isCancelled?.()).toBe(true)
  expect(onProgress).toHaveBeenCalledOnce()

  second.hooks.onProgress?.(progress)
  expect(second.isCurrent()).toBe(true)
  expect(onProgress).toHaveBeenCalledTimes(2)

  pool.reset()
  expect(second.isCurrent()).toBe(false)
  expect(second.hooks.isCancelled?.()).toBe(true)
})
