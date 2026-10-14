/*
  Author: Runor Ewhro
  description: matches lazy worker requests with replies and manages pending work, errors, and idle teardown.
*/

export class WorkerChannel<Request extends { id: number }, Response extends { id: number }> {
  private readonly options: {
    createWorker: () => Worker
    idleMs: number
    errorMessage: string
    isProgress?: (message: Response) => boolean
    onIdle?: () => void
  }
  private worker: Worker | null = null
  private pending = new Map<number, {
    resolve: (message: Response) => void
    reject: (error: Error) => void
    onProgress?: (message: Response) => void
  }>()
  private nextId = 1
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: {
    createWorker: () => Worker
    idleMs: number
    errorMessage: string
    isProgress?: (message: Response) => boolean
    onIdle?: () => void
  }) { this.options = options }

  get hasPending(): boolean { return this.pending.size > 0 }

  request(
    makeMessage: (id: number) => Request,
    options: { transfer?: Transferable[]; onProgress?: (message: Response) => void } = {},
  ): Promise<Response> {
    this.clearIdleTimer()
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject, onProgress: options.onProgress })
      try {
        this.ensureWorker().postMessage(makeMessage(id), options.transfer ?? [])
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
        this.scheduleIdle()
      }
    })
  }

  /** release an idle worker immediately without interrupting active requests. */
  disposeIfIdle(): void {
    if (!this.hasPending) this.dispose(new Error('Worker channel disposed'))
  }

  /** termination rejects every request because no further reply can arrive. */
  dispose(reason: Error): void {
    this.clearIdleTimer()
    this.worker?.terminate()
    this.worker = null
    for (const pending of this.pending.values()) pending.reject(reason)
    this.pending.clear()
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = this.options.createWorker()
    worker.onmessage = (event: MessageEvent<Response>) => {
      const message = event.data
      const pending = this.pending.get(message.id)
      if (!pending) return
      if (this.options.isProgress?.(message)) {
        pending.onProgress?.(message)
        return
      }
      this.pending.delete(message.id)
      pending.resolve(message)
      this.scheduleIdle()
    }
    worker.onerror = (event) => {
      if (this.worker !== worker) return
      this.dispose(new Error(event.message || this.options.errorMessage))
    }
    this.worker = worker
    return worker
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private scheduleIdle(): void {
    this.clearIdleTimer()
    if (this.pending.size > 0 || !this.worker) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.pending.size > 0) return
      this.worker?.terminate()
      this.worker = null
      this.options.onIdle?.()
    }, this.options.idleMs)
    ;(this.idleTimer as unknown as { unref?: () => void }).unref?.()
  }
}
