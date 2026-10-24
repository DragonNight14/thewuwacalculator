/*
  Author: Runor Ewhro
  description: verifies search-time crit constraints agree with retained-row
               scoring and the percentage values exposed by optimizer settings.
*/

import { describe, expect, it } from 'vitest'
import { packTargetSkill } from '@/engine/optimizer/payloads/targetPayload'
import { makeCpuScratch } from '@/engine/optimizer/cpu/scratch'
import { evalTgtCpuCm } from '@/engine/optimizer/target/cpu'
import { evalTarget } from '@/engine/search/score/evaluate'
import { gnrtTgtCpuCm } from '@/engine/optimizer/target/batches'
import { DISABLED_CONSTRAINTS, encTgtStatCstrs } from '@/engine/search/score/statConstraints'
import { makeOptSets } from '@/engine/runtime/defaults'
import { inventory, payloadFor } from './fixtures'

// crit limits use displayed values in both search and retained result scoring.
describe('crit limits', () => {
  for (const resonatorId of ['1205', '1209', '1306', '1505']) {
    it(`search and row scorers agree under crit limits (${resonatorId})`, () => {
      const invChs = inventory(Number(resonatorId) + 3, 14)
      // 1209's conditional crit applies to liberation damage only
      const payload = payloadFor(resonatorId, invChs, null, {},
        resonatorId === '1209' ? (skill) => skill.skillType.includes('resonanceLiberation') : undefined)
      const packed = packTargetSkill(payload)
      const scratch = makeCpuScratch()
      const rows = { context: packed.context, stats: payload.stats, setConstLut: payload.setConstLut,
        mainEchoBuffs: payload.mainEchoBuffs, sets: payload.sets, kinds: payload.kinds }
      const builds: Array<{ ids: Int32Array; main: number }> = []
      for (const batch of gnrtTgtCpuCm({ costs: payload.costs, batchSize: 4096, lockMainIdx: -1 })) {
        for (let combo = 0; combo < batch.comboCount; combo += 1) {
          const ids = batch.combos.slice(combo * 5, combo * 5 + 5)
          for (const main of ids) builds.push({ ids, main })
        }
      }
      // windows at the median displayed crit rate and crit damage
      const shown = builds.map(({ ids, main }) => evalTarget({ ...rows, comboIds: ids, mainIndex: main })!.stats)
      // a floor midway between two distinct middle values: it splits the builds,
      // and no build sits on it (the scorers sum stats in different orders)
      const median = (values: number[]) => {
        const unique = [...new Set(values)].sort((a, b) => a - b)
        const at = Math.max(1, unique.length >> 1)
        return unique.length < 2 ? null : (unique[at - 1]! + unique[at]!) / 2
      }
      const windows = [
        [6, median(shown.map((stats) => stats.cr / 100))],
        [8, median(shown.map((stats) => stats.cd / 100))],
      ] as const
      let checked = 0
      for (const [slot, floor] of windows) {
        if (floor == null) continue
        checked += 1
        const constraints = new Float32Array(DISABLED_CONSTRAINTS)
        constraints[slot] = floor
        constraints[slot + 1] = Number.POSITIVE_INFINITY
        let kept = 0
        for (const { ids, main } of builds) {
          const row = evalTarget({ ...rows, constraints, comboIds: ids, mainIndex: main }) != null
          const search = evalTgtCpuCm({ ...rows, constraints, comboIds: ids, lockMainIdx: main, scratch }) != null
          expect(search).toBe(row)
          if (row) kept += 1
        }
        expect(kept).toBeGreaterThan(0)
        expect(kept).toBeLessThan(builds.length)
      }
      expect(checked).toBeGreaterThan(0)
    }, 30_000)
  }

  // limits are typed as displayed; a build passes exactly when its displayed
  // value clears the limit, for every percent-typed stat
  it('limits typed as displayed keep the builds whose displayed stats clear them', () => {
    const invChs = inventory(1213, 12)
    const payload = payloadFor('1205', invChs, null)
    const packed = packTargetSkill(payload)
    const rows = { context: packed.context, stats: payload.stats, setConstLut: payload.setConstLut,
      mainEchoBuffs: payload.mainEchoBuffs, sets: payload.sets, kinds: payload.kinds }
    const builds: Int32Array[] = []
    for (const batch of gnrtTgtCpuCm({ costs: payload.costs, batchSize: 4096, lockMainIdx: -1 })) {
      for (let combo = 0; combo < batch.comboCount; combo += 1) builds.push(batch.combos.slice(combo * 5, combo * 5 + 5))
    }
    const shown = builds.map((ids) => evalTarget({ ...rows, comboIds: ids, mainIndex: ids[0]! })!.stats)
    for (const key of ['cr', 'cd', 'bonus', 'er'] as const) {
      const unique = [...new Set(shown.map((stats) => stats[key]))].sort((a, b) => a - b)
      expect(unique.length).toBeGreaterThan(1)
      const floor = (unique[(unique.length >> 1) - 1]! + unique[unique.length >> 1]!) / 2
      const constraints = encTgtStatCstrs({ ...makeOptSets(), statConstraints: { [key]: { minTotal: String(floor) } } })
      builds.forEach((ids, index) => {
        const passes = evalTarget({ ...rows, constraints, comboIds: ids, mainIndex: ids[0]! }) != null
        expect(passes).toBe(shown[index]![key] > floor)
      })
    }
  })
})
