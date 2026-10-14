/*
  Author: Runor Ewhro
  description: keeps rotation import choices across sessions and older saved ui layouts.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { persistedSchema } from '@/engine/runtime/schema'
import { selectPersisted } from '@/application/state/serialization'
import { useAppStore } from '@/application/state/store'
import { APPSTOREUILY, consumePersist, loadPrssAppS, saveAppState } from '@/application/persistence/storage'

describe('rotation import preferences', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumePersist()
  })

  it('defaults older snapshots to loading the full build and saving a copy', () => {
    const snapshot = structuredClone(selectPersisted(useAppStore.getState())) as unknown as {
      ui: { preferences: Record<string, unknown> }
    }
    delete snapshot.ui.preferences.rotationImportPick

    expect(persistedSchema.parse(snapshot).ui.preferences.rotationImportPick).toEqual({
      load: 'build',
      save: true,
    })
  })

  it('persists the chosen actions in the UI layout domain', () => {
    const pick = { load: 'rotation' as const, save: false }
    useAppStore.getState().setRotationImportPick(pick)
    expect(consumePersist()).toEqual(['ui.layout'])

    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      get length() { return values.size },
    } as Storage)
    try {
      saveAppState(useAppStore.getState(), { domains: ['ui.layout'] })
      const stored = JSON.parse(values.get(APPSTOREUILY) ?? '{}') as {
        ui?: { preferences?: { rotationImportPick?: typeof pick } }
      }
      expect(stored.ui?.preferences?.rotationImportPick).toEqual(pick)
      expect(loadPrssAppS({ includeInventory: false })?.ui.preferences.rotationImportPick).toEqual(pick)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
