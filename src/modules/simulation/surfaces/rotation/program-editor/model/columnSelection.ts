/*
  Author: Runor Ewhro
  description: preserves columns temporarily hidden by the viewport or docked panel.
*/

import type { StatKey } from '@/modules/simulation/surfaces/rotation/program-editor/presentation/registerRows'

export interface ColumnSelection {
  ceiling: number
  visible: readonly StatKey[]
  hidden: readonly StatKey[]
}

export function fitColumnSelection(
  keys: readonly StatKey[],
  ceiling: number,
): ColumnSelection {
  return { ceiling, visible: keys.slice(0, ceiling), hidden: keys.slice(ceiling) }
}

export function resizeColumnSelection(
  selection: ColumnSelection,
  ceiling: number,
): ColumnSelection {
  return selection.ceiling === ceiling
    ? selection
    : fitColumnSelection([...selection.visible, ...selection.hidden], ceiling)
}

export function editColumnSelection(
  selection: ColumnSelection,
  keys: readonly StatKey[],
): ColumnSelection {
  const visible = keys.slice(0, selection.ceiling)
  return {
    ...selection,
    visible,
    hidden: selection.hidden.filter((key) => !visible.includes(key)),
  }
}
