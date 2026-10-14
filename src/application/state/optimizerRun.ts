/*
  Author: Runor Ewhro
  description: loads optimizer execution only after a run is requested, while
               the root store keeps its small synchronous status interface.
*/

import type { OptimizerRunState } from './optimizerRunStore'
import type { OptBckn, OptPrgr, OptStartPay } from '@/engine/optimizer/types'
import { runOptWithWr, rstOptWrkrPo, cnclActOptWr } from '@/engine/optimizer/workers/poolClient'
import { ROT_GPU_JOB, CPU_THEORY_JOB, GPU_THEORY_JOB } from '@/engine/optimizer/config/constants'
import { errorOpt, logOptimizer } from '@/engine/optimizer/config/log'
import {
  bgnOptRun, compOptPayIn, ensOptCompWr, nvldOptRun, isOptRunCur,
  matOptRsltsI, resOptBtchSi, stopOptCompW,
} from '@/application/state/storeOptimizerRuntime'

type SetStore = (updater: (state: OptimizerRunState) => OptimizerRunState) => void
type RunHooks = { onProgress?: (progress: OptPrgr) => void; settle?: () => Promise<unknown> }

export function cancelOptimizerRun(): void {
  nvldOptRun()
  stopOptCompW()
  cnclActOptWr()
  rstOptWrkrPo()
}

export function disposeOptimizerRun(): void {
  stopOptCompW()
  rstOptWrkrPo()
}

export function startOptimizerRun(
  set: SetStore,
  input: OptStartPay,
  hooks: RunHooks,
  isCurrent: () => boolean,
): void {
  if (!isCurrent()) return
  rstOptWrkrPo()
  const runToken = bgnOptRun()
  const current = () => isCurrent() && isOptRunCur(runToken)

  logOptimizer('[optimizer:store] run started', {
    runToken,
    resonatorId: input.resonatorId,
    rotationMode: input.settings.rotationMode,
    enableGpu: input.settings.enableGpu,
    lowMem: input.settings.lowMemoryMode,
    invSize: input.invChs.length,
    resultsLimit: input.settings.resultsLimit,
    sabAvail: typeof SharedArrayBuffer !== 'undefined',
  })

  const compWrkr = ensOptCompWr()
  const runStartTime = performance.now()
  void (async () => {
    try {
      await hooks.settle?.()
      if (!current()) return

      const compPay = await compOptPayIn(compWrkr, runToken, input)
      if (!current()) return
      const backend: OptBckn = input.settings.enableGpu ? 'gpu' : 'cpu'
      logOptimizer('[optimizer:store] starting pool search', {
        runToken,
        backend,
        mode: compPay.mode,
        totalCombos: compPay.totalCombos,
        resultsLimit: compPay.resultsLimit,
        lowMem: compPay.lowMmryMode,
      })
      set((state) => ({
        ...state,
        batchSize: compPay.mode === 'theoryTarget' || compPay.mode === 'theoryRotation'
          ? backend === 'gpu' ? GPU_THEORY_JOB : CPU_THEORY_JOB
          : compPay.mode === 'rotation' && backend === 'gpu'
            ? ROT_GPU_JOB : resOptBtchSi(backend),
        resPay: null,
      }))

      hooks.onProgress?.({
        progress: 0, elapsedMs: 0, remainingMs: Infinity, processed: 0,
        speed: 0, total: compPay.totalCombos, phase: 'evaluating', discovered: 0,
      })
      const searchT0 = performance.now()
      const results = await runOptWithWr(compPay, backend, {
        isCancelled: () => !current(),
        onProgress: (progress) => { if (current()) hooks.onProgress?.(progress) },
      })
      if (!current()) return
      logOptimizer('[optimizer:store] pool search complete', {
        runToken, rawRsltCnt: results.length, srchMs: Math.round(performance.now() - searchT0),
      })

      const lazyTheory = compPay.mode === 'theoryTarget' || compPay.mode === 'theoryRotation'
      const fnlzRslts = await matOptRsltsI(
        compWrkr, runToken, compPay, results,
        lazyTheory ? [] : input.invChs.map((echo) => echo.uid), compPay.resultsLimit,
      )
      if (!current()) return
      logOptimizer('[optimizer:store] run complete', {
        runToken, finRsltCnt: fnlzRslts.length, lazyTheory,
        ttlMs: Math.round(performance.now() - runStartTime),
      })
      set((state) => ({
        status: 'done', progress: state.progress,
        results: fnlzRslts, error: null, batchSize: state.batchSize,
        resPay: null, resultEchoes: [],
      }))
      disposeOptimizerRun()
    } catch (error) {
      errorOpt('[optimizer:store] run failed', {
        runToken,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        elapsedMs: Math.round(performance.now() - runStartTime),
      })
      if (!current()) return
      cancelOptimizerRun()
      set((state) => ({
        status: 'error', progress: state.progress, results: [],
        error: error instanceof Error ? error.message : 'Optimizer worker pool failed unexpectedly',
        batchSize: state.batchSize, resPay: null, resultEchoes: [],
      }))
    }
  })()
}
