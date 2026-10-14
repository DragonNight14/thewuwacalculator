/*
  Author: Runor Ewhro
  description: builds rotation-editor context actions for authored nodes, executed rows, and selections.
*/

import { CheckCheck, ClipboardPaste, Copy, CopyPlus, Eraser, Gauge, GitCompare, ListEnd, Power, PowerOff, RotateCcw, Scissors, SquareDashedMousePointer, TextQuote, Trash2, Unlink, X } from 'lucide-react'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import type { EditConfig } from '@/modules/simulation/surfaces/rotation/shared/authoringTypes.ts'
import { withEditMenu } from '@/modules/simulation/surfaces/rotation/shared/nodeTools.ts'
import type { EditorNode } from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import type { SelectionActions } from '@/modules/simulation/surfaces/rotation/program-editor/components/InspectPanels.tsx'

export interface RowCtxActions {
  node: EditorNode
  /** false for a piece of a loop, which is not a node of its own to act on */
  canLift: boolean
  onLoopify: () => void
  onBlockify: () => void
  onRemoveEnd: () => void
  onToggleEnabled: () => void
  onDelete: () => void
  /** only on a feature standing after a tune break, which is the only place it means anything */
  offTuneResume?: { marked: boolean; onSelect: () => void }
  edit: EditConfig
}

export function makeRowMenu(actions: RowCtxActions): MenuEntry[] {
  const { node } = actions
  if (node.type === 'setup') {
    return []
  }

  if (node.type === 'note') {
    return withEditMenu([{
      id: `rte-ctx:${node.id}:delete`,
      label: 'Delete note',
      icon: <Trash2 size="1em" />,
      danger: true,
      onSelect: actions.onDelete,
    }], actions.edit)
  }

  const isLoop = node.type === 'loop'

  return withEditMenu([
    ...(isLoop
      ? [{
        id: `rte-ctx:${node.id}:remove-end`,
        label: 'Remove end',
        hint: 'Runs back around to its own start',
        icon: <Unlink size="1em" />,
        disabled: Boolean(node.noEnd),
        onSelect: actions.onRemoveEnd,
      } satisfies MenuEntry]
      : []),
    {
      id: `rte-ctx:${node.id}:loopify`,
      label: 'Loopify',
      icon: <RotateCcw size="1em" />,
      disabled: !actions.canLift,
      onSelect: actions.onLoopify,
    },
    {
      id: `rte-ctx:${node.id}:blockify`,
      label: 'Blockify',
      icon: <TextQuote size="1em" />,
      disabled: !actions.canLift,
      onSelect: actions.onBlockify,
    },
    ...(actions.offTuneResume
      ? [{
        id: `rte-ctx:${node.id}:off-tune-resume`,
        label: actions.offTuneResume.marked
          ? 'Clear Off-Tune resume'
          : 'Off-Tune resumes here',
        hint: actions.offTuneResume.marked
          ? 'Use the default Off-Tune resume point'
          : 'Prevent Off-Tune until this feature',
        icon: <Gauge size="1em" />,
        onSelect: actions.offTuneResume.onSelect,
      } satisfies MenuEntry]
      : []),
    { type: 'separator' },
    {
      id: `rte-ctx:${node.id}:enabled`,
      label: node.disabled ? 'Enable' : 'Disable',
      icon: node.disabled ? <PowerOff size="1em" /> : <Power size="1em" />,
      onSelect: actions.onToggleEnabled,
    },
    {
      id: `rte-ctx:${node.id}:delete`,
      label: 'Delete',
      icon: <Trash2 size="1em" />,
      danger: true,
      onSelect: actions.onDelete,
    },
  ], actions.edit)
}

export function makeSelectedNodesMenu(actions: SelectionActions, count: number): MenuEntry[] {
  return [
    ...(actions.onCompare ? [{ id: 'rte-selection:compare', label: actions.compareLabel ?? 'Compare', icon: <GitCompare size="1em" />, disabled: !actions.canCompare, onSelect: actions.onCompare } satisfies MenuEntry] : []),
    ...(actions.onLoopify ? [{ id: 'rte-selection:loopify', label: 'Loopify', icon: <RotateCcw size="1em" />, disabled: !actions.hasSelection, onSelect: actions.onLoopify } satisfies MenuEntry] : []),
    ...(actions.onBlockify ? [{ id: 'rte-selection:blockify', label: 'Blockify', icon: <TextQuote size="1em" />, disabled: !actions.hasSelection, onSelect: actions.onBlockify } satisfies MenuEntry] : []),
    { id: 'rte-selection:copy', label: 'Copy', icon: <Copy size="1em" />, disabled: !actions.canCopy, onSelect: actions.onCopy },
    ...(actions.onCut ? [{ id: 'rte-selection:cut', label: 'Cut', icon: <Scissors size="1em" />, disabled: !actions.canCopy, onSelect: actions.onCut } satisfies MenuEntry] : []),
    ...(actions.onPaste ? [{ id: 'rte-selection:paste', label: 'Paste', icon: <ClipboardPaste size="1em" />, disabled: !actions.canPaste, onSelect: actions.onPaste } satisfies MenuEntry] : []),
    ...(actions.onDuplicate ? [{ id: 'rte-selection:duplicate', label: 'Duplicate', icon: <CopyPlus size="1em" />, disabled: !actions.canCopy, onSelect: actions.onDuplicate } satisfies MenuEntry] : []),
    { type: 'separator' },
    { id: 'rte-selection:all', label: 'Select all', icon: <CheckCheck size="1em" />, onSelect: actions.onSelectAll },
    { id: 'rte-selection:clear', label: 'Clear selection', icon: <Eraser size="1em" />, disabled: !actions.hasSelection, onSelect: actions.onClear },
    { id: 'rte-selection:exit', label: 'Exit selection', icon: <X size="1em" />, onSelect: actions.onExit },
    ...(actions.onDelete ? [{ type: 'separator' } as MenuEntry, { id: 'rte-selection:delete', label: count > 0 ? `Delete ${count}` : 'Delete', icon: <Trash2 size="1em" />, danger: true, disabled: !actions.hasSelection, onSelect: actions.onDelete } satisfies MenuEntry] : []),
  ]
}

export function makeAddToSelectionMenu(onAdd: () => void, actions: SelectionActions): MenuEntry[] {
  return [
    { id: 'rte-selection:add', label: 'Add to selection', icon: <SquareDashedMousePointer size="1em" />, onSelect: onAdd },
    { type: 'separator' },
    { id: 'rte-selection:all', label: 'Select all', icon: <CheckCheck size="1em" />, onSelect: actions.onSelectAll },
    { id: 'rte-selection:exit', label: 'Exit selection', icon: <X size="1em" />, onSelect: actions.onExit },
  ]
}

interface PickCtxActions {
  /** what the tile stands for, named so the menu can say what it adds */
  label: string
  /** where a plain press would put it, which is after whatever is selected */
  hasSelection: boolean
  onAdd: () => void
  onAddAtEnd: () => void
}

/**
 * what a palette tile offers. pressing one already adds it after the selected
 * row, so the menu's own job is to offer the other place it could go.
 */
export function makeSelectionMenu(actions: PickCtxActions): MenuEntry[] {
  return [
    {
      id: 'rte-pick:add',
      label: `Add ${actions.label}`,
      hint: actions.hasSelection ? 'After the selected row' : 'At the end',
      icon: <CopyPlus size="1em" />,
      onSelect: actions.onAdd,
    },
    {
      id: 'rte-pick:add-end',
      label: 'Add at the end',
      icon: <ListEnd size="1em" />,
      disabled: !actions.hasSelection,
      onSelect: actions.onAddAtEnd,
    },
  ]
}
