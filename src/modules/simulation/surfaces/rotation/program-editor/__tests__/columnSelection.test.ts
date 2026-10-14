/*
  Author: Runor Ewhro
  description: verifies rotation column choices survive temporary viewport
               ceilings and remain valid after explicit edits.
*/

import { describe, expect, it } from 'vitest'
import {
  editColumnSelection,
  fitColumnSelection,
  resizeColumnSelection,
} from '../model/columnSelection'
import { DEFAULT_STAT_KEYS } from '../presentation/registerRows'

describe('rotation column selection', () => {
  const keys = DEFAULT_STAT_KEYS.slice(0, 12)

  it('restores ordered columns across viewport and docking changes', () => {
    let selection = fitColumnSelection(keys, 12)
    for (const ceiling of [11, 6, 7, 6, 11, 12]) {
      selection = resizeColumnSelection(selection, ceiling)
      expect(selection.visible).toEqual(keys.slice(0, ceiling))
      expect([...selection.visible, ...selection.hidden]).toEqual(keys)
    }
  })

  it('keeps a user removal distinct from temporarily hidden columns', () => {
    let selection = fitColumnSelection(keys, 6)
    selection = editColumnSelection(selection, selection.visible.slice(1))
    expect(selection.visible).toHaveLength(5)
    expect(resizeColumnSelection(selection, 6)).toBe(selection)
    selection = resizeColumnSelection(selection, 12)
    expect(selection.visible).toEqual(keys.slice(1))
    expect(selection.hidden).toEqual([])
  })

  it('retains hidden columns when saving a narrow selection and reopening wider', () => {
    const narrow = editColumnSelection(fitColumnSelection(keys, 11), keys.slice(1, 11))
    const persisted = [...narrow.visible, ...narrow.hidden]
    expect(fitColumnSelection(persisted, 12).visible).toEqual(keys.slice(1))
  })

  it('does not duplicate a hidden column when the user enables it in a spare slot', () => {
    const narrow = fitColumnSelection(keys, 6)
    const next = [...narrow.visible.slice(1), narrow.hidden[0]!]
    const edited = editColumnSelection(narrow, next)
    expect([...edited.visible, ...edited.hidden]).toEqual([
      ...keys.slice(1, 6), ...keys.slice(6),
    ])
  })
})
