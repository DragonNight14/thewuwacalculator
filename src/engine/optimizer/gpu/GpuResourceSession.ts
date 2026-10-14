/*
  Author: Runor Ewhro
  description: replaces and disposes gpu resources for an initialized optimizer
               payload.
*/

export class GpuResourceSession<State> {
  private state: State | null = null
  private readonly destroy: (state: State) => void

  constructor(destroy: (state: State) => void) { this.destroy = destroy }

  get current(): State | null { return this.state }

  set current(next: State | null) {
    if (next === this.state) return
    this.dispose()
    this.state = next
  }

  dispose(): void {
    const state = this.state
    this.state = null
    if (state) this.destroy(state)
  }
}
