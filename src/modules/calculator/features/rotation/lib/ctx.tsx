/*
  Author: Runor Ewhro
  Description: Hosts shared rotation-pane context, selection state, modal
               state, and controller helpers for the split rotation surface.
*/

import {
  ArrowDownNarrowWide as RrwDownNrrwW,
  ArrowUpAZ,
  ArrowUpNarrowWide as RrwUpNrrwWid,
  Funnel,
  ListPlus,
  ListRestart,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Share2,
  Trash2,
  UserRoundSearch as UserRndSrch,
  X,
} from 'lucide-react'
import { PiDownloadSimpleBold as PiDwnlSmplBo } from 'react-icons/pi'
import { CgListTree } from 'react-icons/cg'
import type { InvRotEnt } from '@/domain/entities/inventoryStorage'
import type { RotationNode } from '@/domain/gameData/contracts'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import type { EditConfig } from '@/modules/calculator/features/rotation/lib/types.ts'
import { withEditMenu } from '@/modules/calculator/features/rotation/lib/utils.ts'

interface RotPaneMenu {
  pane: (args: { items: MenuEntry[] }) => MenuEntry[]
  item: (args: { items: MenuEntry[] }) => MenuEntry[]
}

interface GetRotEditCt {
  menu: RotPaneMenu
  mode: 'personal' | 'team'
  view: 'personal' | 'team' | 'saved'
  append: Array<{ value: string; label: string; items: RotationNode[] }>
  onAddFeat: () => void
  onAddCond: () => void
  onAddBlock: () => void
  onLoopify: () => void
  onPreset: () => void
  onSave: () => void
  onClear: () => void
  onAppend: (items: RotationNode[]) => void
  edit: EditConfig
}

interface GetRotSvdPan {
  menu: RotPaneMenu
  sort: 'asc' | 'desc'
  auto: boolean
  seedName: string
  canClear: boolean
  pickImport: () => void
  onClear: () => void
  onSortBy: (value: 'date' | 'name' | 'avg' | 'dps') => void
  onSort: () => void
  onFilter: (value: 'all' | 'personal' | 'team') => void
  onAuto: () => void
  edit: EditConfig
}

interface GetRotSvdIte {
  menu: RotPaneMenu
  entry: InvRotEnt
  edit: EditConfig
  onActs: () => void
  onEdit: () => void
  onShare: () => void
  onLoad: () => void
  onDel: () => void
}

export function getRotEditCt({
  menu,
  mode,
  view,
  append,
  onAddFeat,
  onAddCond,
  onAddBlock,
  onLoopify,
  onPreset,
  onSave,
  onClear,
  onAppend,
  edit,
}: GetRotEditCt): MenuEntry[] {
  const items: Array<MenuEntry | null> = [
    {
      id: 'add-feature',
      label: 'Feature',
      icon: <Plus size="1em" />,
      onSelect: onAddFeat,
    },
    {
      id: 'add-condition',
      label: 'Condition',
      icon: <Plus size="1em" />,
      onSelect: onAddCond,
    },
    {
      id: 'add-block',
      label: 'Block',
      icon: <Plus size="1em" />,
      onSelect: onAddBlock,
    },
    {
      id: 'loopify-rotation',
      label: 'Loopify',
      icon: <ListRestart size="1em" />,
      onSelect: onLoopify,
    },
    { type: 'separator' },
    mode === 'personal'
      ? {
          id: 'preset',
          label: 'Preset',
          icon: <RotateCcw size="1em" />,
          onSelect: onPreset,
        }
      : null,
    {
      id: 'save',
      label: 'Save',
      icon: <Save size="1em" />,
      onSelect: onSave,
    },
    {
      id: 'clear',
      label: 'Clear',
      icon: <X size="1em" />,
      danger: true,
      onSelect: onClear,
    },
    view === 'team' && append.length > 0 ? { type: 'separator' } : null,
    view === 'team' && append.length > 0
      ? {
          id: 'append',
          label: 'Append...',
          icon: <ListPlus size="1em" />,
          submenu: append.map((entry) => ({
            id: `append:${entry.value}`,
            label: entry.label,
            onSelect: () => onAppend(entry.items),
          })),
        }
      : null,
  ]

  return withEditMenu(
    menu.pane({
      items: items.filter((item): item is MenuEntry => item !== null),
    }),
    edit,
  )
}

export function getRotSvdPan({
  menu,
  sort,
  auto,
  seedName,
  canClear,
  pickImport,
  onClear,
  onSortBy,
  onSort,
  onFilter,
  onAuto,
  edit,
}: GetRotSvdPan): MenuEntry[] {
  return withEditMenu(menu.pane({
    items: [
      {
        id: 'sort-by',
        label: 'Sort by...',
        icon: <ArrowUpAZ size="1em" />,
        submenu: [
          { id: 'sort-date', label: 'Date', onSelect: () => onSortBy('date') },
          { id: 'sort-name', label: 'Name', onSelect: () => onSortBy('name') },
          { id: 'sort-avg', label: 'Avg DMG', onSelect: () => onSortBy('avg') },
          { id: 'sort-dps', label: 'DPS', onSelect: () => onSortBy('dps') },
        ],
      },
      {
        id: 'sort-order',
        icon: sort === 'desc' ? <RrwUpNrrwWid size="1em" /> : <RrwDownNrrwW size="1em" />,
        label: sort === 'desc' ? 'Ascending' : 'Descending',
        onSelect: onSort,
      },
      { type: 'separator' },
      {
        id: 'import',
        label: 'Import',
        icon: <RrwDownNrrwW size="1em" />,
        onSelect: pickImport,
      },
      {
        id: 'clear-saved',
        label: 'Clear',
        icon: <X size="1em" />,
        danger: true,
        disabled: !canClear,
        onSelect: onClear,
      },
      { type: 'separator' },
      {
        id: 'filter',
        label: 'Filter...',
        icon: <Funnel size="1em" />,
        submenu: [
          { id: 'filter-all', label: 'All', onSelect: () => onFilter('all') },
          { id: 'filter-personal', label: 'Personal', onSelect: () => onFilter('personal') },
          { id: 'filter-team', label: 'Team', onSelect: () => onFilter('team') },
        ],
      },
      {
        id: 'auto-search-active',
        icon: <UserRndSrch size="1em" />,
        label: auto ? 'Disable active search' : 'Search active resonator',
        onSelect: () => {
          void seedName
          onAuto()
        },
      },
    ],
  }), edit)
}

export function getRotSvdIte({
  menu,
  edit,
  onActs,
  onEdit,
  onShare,
  onLoad,
  onDel,
}: GetRotSvdIte): MenuEntry[] {
  return menu.item({
    items: withEditMenu([
      {
        id: 'show-actions',
        label: 'Actions',
        icon: <CgListTree size="1em" />,
        onSelect: onActs,
      },
      {
        id: 'edit-saved',
        label: 'Edit details',
        icon: <Pencil size="1em" />,
        onSelect: onEdit,
      },
      {
        id: 'share-saved',
        label: 'Share',
        icon: <Share2 size="1em" />,
        onSelect: onShare,
      },
      {
        id: 'load-saved',
        label: 'Load',
        icon: <PiDwnlSmplBo size="1em" />,
        onSelect: onLoad,
      },
      { type: 'separator' },
      {
        id: 'delete-saved',
        label: 'Delete',
        icon: <Trash2 size="1em" />,
        danger: true,
        onSelect: onDel,
      },
    ], edit),
  })
}
