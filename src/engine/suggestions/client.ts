/*
  Author: Runor Ewhro
  description: manages suggestions worker requests and idle teardown.
*/

import type {
  CompactSetPlanRun, CompactSuggestionJob, MainStatSugg, MainStatPrep,
  PrepSetPlanS, PrepWeaponPlan, SetPlanSugoi, SuggsWrkrInM, SuggsWrkrOut, WeaponEntry,
  SuggestionRequestDiagnostics,
} from '@/engine/suggestions/types'
import { getGameDataMode } from '@/data/gameData'
import { WorkerChannel } from '@/shared/lib/WorkerChannel'

class SuggestionsClient {
  private workerGeneration = 0
  private readonly channel = new WorkerChannel<SuggsWrkrInM, SuggsWrkrOut>({
    createWorker: () => {
      const worker = new Worker(new URL('@/engine/suggestions/worker.ts', import.meta.url), { type: 'module' })
      this.workerGeneration += 1
      return worker
    },
    idleMs: 1_200,
    errorMessage: 'Suggestions worker failed unexpectedly',
  })

  disposeIfIdle(): void { this.channel.disposeIfIdle() }
  cancel(): void { this.channel.dispose(new Error('Suggestions cancelled')) }

  private async run<T>(
    message: (id: number) => SuggsWrkrInM,
    onDiagnostics?: (diagnostics: SuggestionRequestDiagnostics) => void,
  ): Promise<T> {
    const startedAt = performance.now()
    const previousGeneration = this.workerGeneration
    let requestId: number | null = null
    const pending = this.channel.request((id) => {
      requestId = id
      return message(id)
    })
    const dispatchMs = performance.now() - startedAt
    const workerGeneration = this.workerGeneration
    const report = (response?: SuggsWrkrOut) => {
      const roundTripMs = performance.now() - startedAt
      onDiagnostics?.({
        requestId, workerGeneration, coldWorker: workerGeneration !== previousGeneration,
        dispatchMs, roundTripMs,
        outsideWorkerMs: Math.max(0, roundTripMs - (response?.diagnostics?.timings.totalMs ?? 0)),
        worker: response?.diagnostics,
      })
    }
    let response: SuggsWrkrOut
    try {
      response = await pending
    } catch (error) {
      report()
      throw error
    }
    report(response)
    if (!response.ok) throw new Error(response.error)
    return response.result as T
  }

  compact(mode: 'mainStats' | 'setPlans' | 'weapons', payload: CompactSuggestionJob, onDiagnostics?: (diagnostics: SuggestionRequestDiagnostics) => void): Promise<MainStatSugg[] | CompactSetPlanRun | WeaponEntry[]> {
    return this.run((id) => ({ id, gameDataMode: getGameDataMode(), type: 'compact', mode, payload }), onDiagnostics)
  }

  mainStats(payload: MainStatPrep): Promise<MainStatSugg[]> {
    return this.run((id) => ({ id, gameDataMode: getGameDataMode(), type: 'mainStats', payload }))
  }

  setPlans(payload: PrepSetPlanS): Promise<SetPlanSugoi> {
    return this.run((id) => ({ id, gameDataMode: getGameDataMode(), type: 'setPlans', payload }))
  }

  weapons(payload: PrepWeaponPlan): Promise<WeaponEntry[]> {
    return this.run((id) => ({ id, gameDataMode: getGameDataMode(), type: 'weapons', payload }))
  }
}

const client = new SuggestionsClient()

export function disposeSuggestionsWorker(): void { client.disposeIfIdle() }
export function cancelSuggestionsJobs(): void { client.cancel() }
export function runCompactSuggestion(mode: 'mainStats' | 'setPlans' | 'weapons', payload: CompactSuggestionJob, onDiagnostics?: (diagnostics: SuggestionRequestDiagnostics) => void): Promise<MainStatSugg[] | CompactSetPlanRun | WeaponEntry[]> {
  return client.compact(mode, payload, onDiagnostics)
}
export function runMainStatS(payload: MainStatPrep): Promise<MainStatSugg[]> { return client.mainStats(payload) }
export function runSetPlanSu(payload: PrepSetPlanS): Promise<SetPlanSugoi> { return client.setPlans(payload) }
export function runWpnSuggs(payload: PrepWeaponPlan): Promise<WeaponEntry[]> { return client.weapons(payload) }
