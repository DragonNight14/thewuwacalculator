/*
  Author: Runor Ewhro
  description: manages random-echo worker requests and idle teardown.
*/

import { getGameDataMode } from '@/data/gameData'
import { WorkerChannel } from '@/shared/lib/WorkerChannel'
import type {
  RandomEchoEntry,
  RandomEchoPrep,
  RandomEchoWorkerRequest,
  RandomEchoWorkerResponse,
} from './types'

class RandomEchoClient {
  private readonly channel = new WorkerChannel<RandomEchoWorkerRequest, RandomEchoWorkerResponse>({
    createWorker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
    idleMs: 1_200,
    errorMessage: 'Random Echo worker failed unexpectedly',
  })

  async run(payload: RandomEchoPrep): Promise<RandomEchoEntry[]> {
    const message = await this.channel.request((id) => ({ id, gameDataMode: getGameDataMode(), payload }))
    if (!message.ok) throw new Error(message.error)
    return message.result
  }
}

const client = new RandomEchoClient()

export function runRandomEchoSuggestions(payload: RandomEchoPrep): Promise<RandomEchoEntry[]> {
  return client.run(payload)
}
