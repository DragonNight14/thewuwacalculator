/*
  Author: Runor Ewhro
  description: defines optimizer settings and run actions, including lazy
               engine loading, request invalidation, and result application.
*/

import type { AppStore } from './store'
import type { StoreSliceContext } from './storeContracts'
import { idleOptimizerRun, resetOptimizerRun, updateOptimizerRun, useOptimizerRunStore } from './optimizerRunStore'
import { compactTheoryEchoes, matThryRsltCh } from '@/engine/optimizer/results/theoryEchoes'
import { CPU_JOB_SIZE, CPU_THEORY_JOB, GPU_THEORY_JOB, ROT_GPU_JOB, TARGET_GPU_JOB } from '@/engine/optimizer/config/constants'
import type { EchoInstance } from '@/domain/entities/runtime'
import { cloneEchoFor } from '@/domain/entities/inventoryStorage'
import type { OptBagResult, OptStartPay } from '@/engine/optimizer/types'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { getActResId } from '@/engine/runtime/runtimeAdapters'

type OptimizerRunModule = typeof import('./optimizerRun')
let optimizerRunModule: OptimizerRunModule | null = null
let optimizerRunLoading: Promise<OptimizerRunModule> | null = null
let optimizerRequestGeneration = 0

function loadOptimizerRun(): Promise<OptimizerRunModule> {
  optimizerRunLoading ??= import('./optimizerRun').then((module) => {
    optimizerRunModule = module
    return module
  }).catch((error) => {
    optimizerRunLoading = null
    throw error
  })
  return optimizerRunLoading
}

export function cancelOptimizerRequest(): void {
  optimizerRequestGeneration += 1
  optimizerRunModule?.cancelOptimizerRun()
}

function disposeOptimizerRequest(): void {
  optimizerRequestGeneration += 1
  optimizerRunModule?.disposeOptimizerRun()
}

function initialOptimizerBatch(input: OptStartPay): number {
  if (input.settings.searchMode === 'theory') return input.settings.enableGpu ? GPU_THEORY_JOB : CPU_THEORY_JOB
  if (input.settings.rotationMode && input.settings.enableGpu) return ROT_GPU_JOB
  return input.settings.enableGpu ? TARGET_GPU_JOB : CPU_JOB_SIZE
}


export type OptimizerActionNames = 'updOptSets' | 'startOpt' | 'cnclOpt' | 'clrOptRslt' | 'disposeOptResources' | 'applyOpt'

export function createOptimizerActions({ get, persistedSet }: Pick<StoreSliceContext, 'get' | 'persistedSet'>): Pick<AppStore, OptimizerActionNames> {
  return {
  updOptSets: (updater, resonatorId) => {
    persistedSet(['simulation.optimizerSettings'], (state) => ({
      ...state,
      simulation: {
        ...state.simulation,
        optimizerSettingsResonatorId:
          resonatorId ?? state.simulation.optimizerSettingsResonatorId,
        optimizerSettings: updater(state.simulation.optimizerSettings),
      },
    }), { historyLabel: 'Updated Optimizer Settings' })
  },

  startOpt: (input, hooks = {}) => {
    if (useOptimizerRunStore.getState().status === 'running') get().cnclOpt()
    const request = ++optimizerRequestGeneration
    updateOptimizerRun(() => ({
      ...idleOptimizerRun(), status: 'running', batchSize: initialOptimizerBatch(input),
    }))
    void loadOptimizerRun().then((module) => {
      if (request !== optimizerRequestGeneration) return
      module.startOptimizerRun(updateOptimizerRun, input, hooks, () => request === optimizerRequestGeneration)
    }).catch((error: unknown) => {
      if (request !== optimizerRequestGeneration) return
      updateOptimizerRun((state) => ({
        ...state, status: 'error', results: [],
        error: error instanceof Error ? error.message : 'Optimizer failed to load',
      }))
    })
  },

  cnclOpt: () => {
    cancelOptimizerRequest()

    updateOptimizerRun((state) => ({ ...state, status: 'cancelled', error: null }))
  },

  clrOptRslt: () => {
    disposeOptimizerRequest()
    resetOptimizerRun()
  },

  disposeOptResources: () => {
    if (useOptimizerRunStore.getState().status === 'running') {
      get().cnclOpt()
      return
    }
    disposeOptimizerRequest()
  },

  applyOpt: (index) => {
    const run = useOptimizerRunStore.getState()
    const result = run.results[index]
    if (!result) return

    const resultPayload = run.resPay
    if (
        resultPayload &&
        (resultPayload.mode === 'theoryTarget' || resultPayload.mode === 'theoryRotation') &&
        ('i0' in result || 'ids' in result)
    ) {
      const nextEchoes = matThryRsltCh(resultPayload, result)
          ?.map((echo, i) => cloneEchoFor(echo, i)) ?? []
      if (nextEchoes.length === 0) return

      const actResId = getActResId(selectedCombatScenario(get().combat))
      if (!actResId) return

      get().updResRt(actResId, (runtime) => ({
        ...runtime,
        build: {
          ...runtime.build,
          echoes: nextEchoes,
        },
      }))
      return
    }

    if ('theory' in result || ('echoes' in result && Array.isArray(result.echoes))) {
      const nextEchoes = ('theory' in result ? compactTheoryEchoes(result) : result.echoes).map((echo, i) => cloneEchoFor(echo, i))
      if (nextEchoes.length === 0) return

      const actResId = getActResId(selectedCombatScenario(get().combat))
      if (!actResId) return

      get().updResRt(actResId, (runtime) => ({
        ...runtime,
        build: {
          ...runtime.build,
          echoes: nextEchoes,
        },
      }))
      return
    }

    if ('uids' in result && Array.isArray(result.uids)) {
      const invChsByUid = new Map(
          get().library.echoes.map((entry) => [entry.echo.uid, entry.echo] as const),
      )

      const nextEchoes = result.uids
          .map((uid) => invChsByUid.get(uid) ?? null)
          .filter((echo): echo is EchoInstance => echo != null)
          .map((echo, i) => cloneEchoFor(echo, i))

      if (nextEchoes.length === 0) return

      const actResId = getActResId(selectedCombatScenario(get().combat))
      if (!actResId) return

      get().updResRt(actResId, (runtime) => ({
        ...runtime,
        build: {
          ...runtime.build,
          echoes: nextEchoes,
        },
      }))
      return
    }

    const bagResult = result as OptBagResult
    const resultEchoes = run.resultEchoes
    const nextEchoes = [
      resultEchoes[bagResult.i0] ?? null,
      resultEchoes[bagResult.i1] ?? null,
      resultEchoes[bagResult.i2] ?? null,
      resultEchoes[bagResult.i3] ?? null,
      resultEchoes[bagResult.i4] ?? null,
    ]
        .filter((echo): echo is EchoInstance => echo != null)
        .map((echo, i) => cloneEchoFor(echo, i))

    if (nextEchoes.length === 0) return

    const actResId = getActResId(selectedCombatScenario(get().combat))
    if (!actResId) return

    get().updResRt(actResId, (runtime) => ({
      ...runtime,
      build: {
        ...runtime.build,
        echoes: nextEchoes,
      },
    }))
  },
  }
}
