/*
  Author: Runor Ewhro
  description: verifies CPU branch bounds cover every legal completion and
               report exact progress for pruned Echo-search prefixes.
*/

import { describe, expect, it } from 'vitest'
import { packTargetSkill } from '@/engine/optimizer/payloads/targetPayload'
import { makeCpuScratch } from '@/engine/optimizer/cpu/scratch'
import { evalTgtCpuCm } from '@/engine/optimizer/target/cpu'
import { gnrtTgtCpuCm } from '@/engine/optimizer/target/batches'
import { mkTgtCpuBound, mkTgtCpuOrder } from '@/engine/optimizer/target/cpuBound'
import { DISABLED_CONSTRAINTS } from '@/engine/search/score/statConstraints'
import { inventory, payloadFor } from './fixtures'

describe('cpu target bound', () => {
  for (const resonatorId of ['1205', '1206', '1209', '1212', '1306', '1412', '1505']) {
    for (const locked of [false, true]) {
      it(`bounds every completion of every prefix (${resonatorId}${locked ? ', locked' : ''})`, () => {
        const invChs = inventory(Number(resonatorId), 16)
        const payload = payloadFor(resonatorId, invChs, locked ? invChs[3]!.id : null)
        const packed = packTargetSkill(payload)
        const locks = payload.lockMainReq ? Array.from(payload.lockMainCands) : [-1]
        const scratch = makeCpuScratch()
        for (const lock of locks) {
          const input = { contexts: [packed.context], stats: payload.stats, costs: payload.costs,
            sets: payload.sets, kinds: payload.kinds, mainEchoBuffs: payload.mainEchoBuffs, setConstLut: payload.setConstLut }
          const order = mkTgtCpuOrder(input)
          const upper = mkTgtCpuBound(input, lock, order)
          const position = new Map(Array.from(order, (echo, at) => [echo, at]))
          // best damage under each two- and three-pick prefix
          const best = new Map<string, number>()
          for (const batch of gnrtTgtCpuCm({ costs: payload.costs, batchSize: 4096, lockMainIdx: lock, order })) {
            for (let combo = 0; combo < batch.comboCount; combo += 1) {
              const ids = batch.combos.slice(combo * 5, combo * 5 + 5)
              const damage = evalTgtCpuCm({ context: packed.context, stats: payload.stats, setConstLut: payload.setConstLut,
                mainEchoBuffs: payload.mainEchoBuffs, sets: payload.sets, kinds: payload.kinds,
                constraints: DISABLED_CONSTRAINTS, comboIds: ids, lockMainIdx: lock, scratch })?.damage ?? 0
              for (const depth of [2, 3]) {
                const key = `${depth}:${Array.from(ids.slice(0, depth)).join(',')}`
                best.set(key, Math.max(best.get(key) ?? 0, damage))
              }
            }
          }
          expect(best.size).toBeGreaterThan(0)
          for (const [key, damage] of best) {
            const [depth, list] = key.split(':') as [string, string]
            const prefix = Int32Array.from(list.split(',').map(Number))
            const cost = Array.from(prefix).reduce((sum, index) => sum + payload.costs[index]!, 0)
            expect(upper(prefix, Number(depth), cost, position.get(prefix.at(-1)!)! + 1)).toBeGreaterThanOrEqual(damage)
          }
        }
      })
    }
  }

  it('reports exactly the combos a pruned branch would have emitted', () => {
    const costs = Uint8Array.from(Array.from({ length: 22 }, (_, i) => [4, 3, 1, 3, 1, 4, 1][i % 7]!))
    // a shuffled walk order must count the same way as the identity one
    const order = Int32Array.from(Array.from({ length: costs.length }, (_, i) => (i * 7) % costs.length))
    for (const lock of [-1, 0, 9, 21]) {
      let total = 0
      for (const batch of gnrtTgtCpuCm({ costs, batchSize: 512, lockMainIdx: lock })) total += batch.comboCount
      for (const depth of [2, 3]) {
        let skipped = 0, emitted = 0
        for (const batch of gnrtTgtCpuCm({ costs, batchSize: 512, lockMainIdx: lock, order,
          prune: (prefix, picked) => picked === depth && prefix[picked - 1]! % 2 === 0,
          onPruned: (count) => { skipped += count } })) emitted += batch.comboCount
        expect(skipped).toBeGreaterThan(0)
        expect(skipped + emitted).toBe(total)
      }
    }
  })
})
