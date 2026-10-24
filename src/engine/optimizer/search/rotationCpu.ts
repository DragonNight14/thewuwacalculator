/*
  Author: Runor Ewhro
  description: runs rotation-mode CPU search, scores generated combo batches
               through the compiled portable program, tracks progress, and returns
               the best bag result refs.
*/

import type {
  OptBagResult,
  OptPrgr,
  PckdRotXctnP,
} from '@/engine/optimizer/types.ts'
import { CPU_JOB_SIZE, PROGRESS_INTERVAL_MS, CPU_PROGRESS_CHECK_COMBOS } from '@/engine/optimizer/config/constants.ts'
import { countMainCombos } from '@/engine/optimizer/search/counting.ts'
import { mkOptPrgrTrc } from '@/engine/optimizer/search/progress.ts'
import { OptResultSet } from '@/engine/optimizer/results/collector.ts'
import { gnrtTgtCpuCm } from '@/engine/optimizer/target/batches.ts'
import { evaluatePortableCombo } from '@/engine/rotation/portable/cpu'

interface RotRunHks {
  // optional cancellation signal
  isCancelled?: () => boolean

  // optional progress callback for the outer full search
  onProgress?: (progress: OptPrgr) => void

  // optional callback with processed row deltas
  onProcessed?: (prcsDlt: number) => void
}

export interface RotSrchBtchS {
  // flattened batch of combos, 5 indices per combo
  combosBatch: Int32Array

  // number of combos inside combosBatch
  comboCount: number

  // forced main echo index, or -1 when all 5 positions may be tested
  lockMainIdx: number

  // local result limit for this batch collector
  jobResultLimit: number
}

// evaluate one pre-generated batch of combos for rotation mode
export async function runRotSrchBt(
    payload: PckdRotXctnP,
    job: RotSrchBtchS,
    hooks: Pick<RotRunHks, 'isCancelled' | 'onProcessed'> = {},
): Promise<OptBagResult[]> {
  if (job.comboCount <= 0) {
    return []
  }

  const collector = new OptResultSet(job.jobResultLimit, payload.lowMmryMode)
  const comboIds = new Int32Array(5)
  let reported = 0
  let lastReport = performance.now()
  const report = (completed: number) => {
    if (completed > reported) hooks.onProcessed?.((completed - reported) * payload.progFact)
    reported = completed
  }

  for (let comboIndex = 0; comboIndex < job.comboCount; comboIndex += 1) {
    if (hooks.isCancelled?.()) {
      report(comboIndex)
      return collector.sorted()
    }

    // each combo occupies 5 consecutive integers in the flattened batch
    comboIds.set(job.combosBatch.subarray(comboIndex * 5, comboIndex * 5 + 5))
    const evaluated = evaluatePortableCombo(payload, comboIds, job.lockMainIdx)
    if (evaluated) collector.pushRdrdCmb(evaluated.damage, comboIds, evaluated.mainIndex, evaluated.weaponIndex)

    if ((comboIndex + 1) % CPU_PROGRESS_CHECK_COMBOS === 0 && performance.now() - lastReport >= PROGRESS_INTERVAL_MS) {
      report(comboIndex + 1)
      // let worker cancellation messages run between bounded slices.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      lastReport = performance.now()
    }
  }

  // report processed rows scaled by payload.progressFactor to stay aligned
  // with how the optimizer counts effective search work
  report(job.comboCount)
  return collector.sorted()
}

// outer cpu rotation search loop
// iterates over locked-main candidates, generates combo batches, evaluates them,
// merges local batch results, and emits throttled progress updates
export async function runRotSrchFo(
    payload: PckdRotXctnP,
    mainIndices: ReadonlyArray<number> | Int32Array,
    hooks: RotRunHks = {},
): Promise<OptBagResult[]> {
  // when main is locked, iterate those candidate indices
  // otherwise use -1 to mean "unlocked main handling"
  const lckdMainNdcs = payload.lockMainReq
      ? mainIndices
      : [-1]

  const totalRows = countMainCombos(
      payload.costs,
      payload.lockMainReq ? lckdMainNdcs : payload.lockMainCands,
  )

  if (totalRows <= 0 || (payload.lockMainReq && lckdMainNdcs.length === 0)) {
    return []
  }

  const collector = new OptResultSet(payload.resultsLimit, payload.lowMmryMode)
  const progress = mkOptPrgrTrc(totalRows, {
    onProgress: hooks.onProgress,
    onProcessed: hooks.onProcessed,
  })

  for (const lockedMainIndex of lckdMainNdcs) {
    for (const batch of gnrtTgtCpuCm({
      costs: payload.costs,
      batchSize: CPU_JOB_SIZE,
      lockMainIdx: lockedMainIndex,
    })) {
      const results = await runRotSrchBt(
          payload,
          {
            combosBatch: batch.combos,
            comboCount: batch.comboCount,
            lockMainIdx: lockedMainIndex,
            jobResultLimit: payload.resultsLimit,
          },
          {
            isCancelled: hooks.isCancelled,
            onProcessed: progress.onProcessed,
          },
      )

      // merge batch-local top results into the global collector
      for (const result of results) {
        collector.push(result)
      }

      if (hooks.isCancelled?.()) {
        progress.emit(true)
        return collector.sorted()
      }
    }
  }

  progress.emit(true)
  return collector.sorted()
}
