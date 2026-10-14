/*
  Author: Runor Ewhro
  description: manages suggestions worker requests and idle teardown.
*/

import type {
  CompactSetPlanSuggest, CompactSuggestionJob, MainStatSugg, MainStatPrep,
  PrepSetPlanS, PrepWeaponPlan, SetPlanSuggest, SuggsWrkrInM, SuggsWrkrOut, WeaponEntry,
} from '@/engine/suggestions/types'
import { getGameDataMode } from '@/data/gameData'
import { WorkerChannel } from '@/shared/lib/WorkerChannel'

class SuggestionsClient {
  private readonly channel = new WorkerChannel<SuggsWrkrInM, SuggsWrkrOut>({
    createWorker: () => new Worker(new URL('@/engine/suggestions/worker.ts', import.meta.url), { type: 'module' }),
    idleMs: 1_200,
    errorMessage: 'Suggestions worker failed unexpectedly',
  })

  disposeIfIdle(): void { this.channel.disposeIfIdle() }
  cancel(): void { this.channel.dispose(new Error('Suggestions cancelled')) }

  private async run<T>(message: (id: number) => SuggsWrkrInM): Promise<T> {
    const response = await this.channel.request(message)
    if (!response.ok) throw new Error(response.error)
    return response.result as T
  }

  compact(mode: 'mainStats' | 'setPlans' | 'weapons', payload: CompactSuggestionJob): Promise<MainStatSugg[] | CompactSetPlanSuggest[] | WeaponEntry[]> {
    return this.run((id) => ({ id, gameDataMode: getGameDataMode(), type: 'compact', mode, payload }))
  }

  mainStats(payload: MainStatPrep): Promise<MainStatSugg[]> {
    return this.run((id) => ({ id, gameDataMode: getGameDataMode(), type: 'mainStats', payload }))
  }

  setPlans(payload: PrepSetPlanS): Promise<SetPlanSuggest[]> {
    return this.run((id) => ({ id, gameDataMode: getGameDataMode(), type: 'setPlans', payload }))
  }

  weapons(payload: PrepWeaponPlan): Promise<WeaponEntry[]> {
    return this.run((id) => ({ id, gameDataMode: getGameDataMode(), type: 'weapons', payload }))
  }
}

const client = new SuggestionsClient()

export function disposeSuggestionsWorker(): void { client.disposeIfIdle() }
export function cancelSuggestionsJobs(): void { client.cancel() }
export function runCompactSuggestion(mode: 'mainStats' | 'setPlans' | 'weapons', payload: CompactSuggestionJob): Promise<MainStatSugg[] | CompactSetPlanSuggest[] | WeaponEntry[]> {
  return client.compact(mode, payload)
}
export function runMainStatS(payload: MainStatPrep): Promise<MainStatSugg[]> { return client.mainStats(payload) }
export function runSetPlanSu(payload: PrepSetPlanS): Promise<SetPlanSuggest[]> { return client.setPlans(payload) }
export function runWpnSuggs(payload: PrepWeaponPlan): Promise<WeaponEntry[]> { return client.weapons(payload) }
