/*
  Author: Runor Ewhro
  description: protects path-level history diffs, compressed transaction replay,
               capacity limits, and immutable-branch preservation across undo and redo.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/application/state/store'
import { consumePersist } from '@/application/persistence/storage'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import {
  applyHistoryEntry,
  makeHistoryEntry,
  queueHistoryCompaction,
  retainQueuedHistoryCompactions,
  type PrssHistEnt,
} from '@/application/state/history'
import { selectPersisted } from '@/application/state/serialization'
import { compressToUTF16 } from 'lz-string'

describe('compact global history', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumePersist()
  })

  it('undoes and redoes only the changed appearance fields', () => {
    const original = useAppStore.getState().ui
    useAppStore.getState().commitAppearanceConfig((ui) => ({
      ...ui,
      blurMode: !ui.blurMode,
      entranceAnimations: !ui.entranceAnimations,
    }))
    const entry = useAppStore.getState().history.past.at(-1)!
    expect(entry.changes.map((change) => change.path.join('.')).sort()).toEqual([
      'ui.blurMode', 'ui.entranceAnimations',
    ])
    consumePersist()
    useAppStore.getState().undo()
    expect(useAppStore.getState().ui.blurMode).toBe(original.blurMode)
    expect(useAppStore.getState().ui.entranceAnimations).toBe(original.entranceAnimations)
    expect(consumePersist()).toEqual(['ui.appearance'])
    useAppStore.getState().redo()
    expect(useAppStore.getState().ui.blurMode).toBe(!original.blurMode)
    expect(useAppStore.getState().ui.entranceAnimations).toBe(!original.entranceAnimations)
  })

  it('restores a scenario edit without replacing unrelated state', () => {
    const before = useAppStore.getState()
    const scenario = selectedCombatScenario(before.combat)
    before.commitScenarioConfig(scenario.id, (current) => ({
      ...current,
      target: { ...current.target, level: current.target.level + 1 },
    }))
    const untouchedLibrary = useAppStore.getState().library
    consumePersist()
    useAppStore.getState().undo()
    expect(selectedCombatScenario(useAppStore.getState().combat).target.level).toBe(scenario.target.level)
    expect(useAppStore.getState().library).toBe(untouchedLibrary)
    expect(consumePersist()).toEqual(['combat.workspace'])
    useAppStore.getState().redo()
    expect(selectedCombatScenario(useAppStore.getState().combat).target.level).toBe(scenario.target.level + 1)
  })

  it('does not hydrate an unchanged getter-backed scenario to record history', () => {
    const before = selectPersisted(useAppStore.getState())
    const scenario = selectedCombatScenario(before.combat)
    let reads = 0
    const records = Object.defineProperties({}, {
      [scenario.id]: { value: scenario, enumerable: true, configurable: true },
      dormant: { get: () => { reads += 1; return scenario }, enumerable: true, configurable: true },
    }) as typeof before.combat.scenariosById
    const first = { ...before, combat: { ...before.combat, order: [...before.combat.order, 'dormant' as typeof scenario.id], scenariosById: records } }
    const second = { ...first, combat: { ...first.combat, selectedScenarioId: 'dormant' as typeof scenario.id } }
    const entry = makeHistoryEntry(first, second, ['combat.workspace'], 'Selected Scenario')!
    expect(reads).toBe(0)
    expect(applyHistoryEntry(second, entry, false).combat.selectedScenarioId).toBe(scenario.id)
  })

  it('replays a compressed cold transaction without retaining its object graph', () => {
    const before = selectPersisted(useAppStore.getState())
    const after = { ...before, ui: { ...before.ui, blurMode: !before.ui.blurMode } }
    const entry = makeHistoryEntry(before, after, ['ui.appearance'], 'Changed Blur')!
    entry.packed = compressToUTF16(JSON.stringify(entry.changes))
    entry.changes = []
    expect(applyHistoryEntry(before, entry, true).ui.blurMode).toBe(after.ui.blurMode)
    expect(applyHistoryEntry(after, entry, false).ui.blurMode).toBe(before.ui.blurMode)
  })

  it('jumps across several undo and redo entries in order', () => {
    const initial = selectedCombatScenario(useAppStore.getState().combat)
    for (let count = 0; count < 3; count += 1) {
      useAppStore.getState().commitScenarioConfig(initial.id, (scenario) => ({
        ...scenario,
        target: { ...scenario.target, level: scenario.target.level + 1 },
      }))
    }
    useAppStore.getState().undoTo(1)
    expect(selectedCombatScenario(useAppStore.getState().combat).target.level).toBe(initial.target.level + 1)
    expect(useAppStore.getState().history.future).toHaveLength(2)
    useAppStore.getState().redoTo(1)
    expect(selectedCombatScenario(useAppStore.getState().combat).target.level).toBe(initial.target.level + 3)
    expect(useAppStore.getState().history.future).toHaveLength(0)
  })

  it('honors the selected capacity and clears redo after a new edit', () => {
    useAppStore.getState().setHistMax(100)
    for (let index = 0; index < 101; index += 1) {
      useAppStore.getState().commitAppearanceConfig((ui) => ({ ...ui, blurMode: !ui.blurMode }))
    }
    expect(useAppStore.getState().history.past).toHaveLength(100)
    useAppStore.getState().undo()
    expect(useAppStore.getState().history.future).toHaveLength(1)
    useAppStore.getState().commitAppearanceConfig((ui) => ({ ...ui, entranceAnimations: !ui.entranceAnimations }))
    expect(useAppStore.getState().history.future).toHaveLength(0)
  })

  it('does not send evicted undo entries to the compression worker', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    const posted: unknown[] = []
    const workers: WorkerStub[] = []
    class WorkerStub {
      constructor() { workers.push(this) }
      onmessage: ((event: MessageEvent<{ packed: string | null }>) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      postMessage(value: unknown) { posted.push(value) }
      terminate() {}
    }
    vi.stubGlobal('Worker', WorkerStub)
    try {
      const entry = (label: string): PrssHistEnt => ({
        label,
        domains: ['combat.workspace'],
        changes: Array.from({ length: 101 }, (_, index) => ({
          path: ['combat', index],
          before: index,
          after: index + 1,
          beforeExists: true,
          afterExists: true,
        })),
      })
      const evicted = entry('evicted')
      const retained = entry('retained')
      queueHistoryCompaction(evicted)
      queueHistoryCompaction(retained)
      retainQueuedHistoryCompactions({ past: [retained], future: [] })
      vi.runOnlyPendingTimers()
      expect(posted).toEqual([retained.changes])
      workers[0]?.onmessage?.({ data: { packed: null } } as MessageEvent<{ packed: string | null }>)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})
