/*
  Author: Runor Ewhro
  description: lazily loads the optimizer worker pool while keeping cleanup
               synchronous and invalidating jobs cancelled during initialization.
*/

type Pool = typeof import('./pool.ts')

/** keeps lazy pool loading and run invalidation in one lifecycle owner. */
export class OptimizerRunController {
  private loadedPool: Pool | null = null
  private pendingPool: Promise<Pool> | null = null
  private generation = 0

  private loadPool(): Promise<Pool> {
    this.pendingPool ??= import('./pool.ts').then((pool) => {
      this.loadedPool = pool
      return pool
    }).catch((error) => {
      this.pendingPool = null
      throw error
    })
    return this.pendingPool
  }

  reset(): void {
    this.generation += 1
    this.loadedPool?.rstOptWrkrPo()
  }

  cancel(): void {
    this.generation += 1
    this.loadedPool?.cnclActOptWr()
  }

  async run(...args: Parameters<Pool['runOptWithWr']>): ReturnType<Pool['runOptWithWr']> {
    const started = this.generation
    const pool = await this.loadPool()
    if (this.generation !== started || args[2]?.isCancelled?.()) return []
    return pool.runOptWithWr(...args)
  }
}

const controller = new OptimizerRunController()

export function rstOptWrkrPo(): void {
  controller.reset()
}

export function cnclActOptWr(): void {
  controller.cancel()
}

export async function runOptWithWr(...args: Parameters<Pool['runOptWithWr']>): ReturnType<Pool['runOptWithWr']> {
  return controller.run(...args)
}
