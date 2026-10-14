/*
  Author: Runor Ewhro
  description: presents game-data buff presets and converts selected entries
               into editable manual buff modifiers.
*/

import { DisplayImage } from '@/shared/ui/DisplayImage'
import { useCallback, useMemo, useState } from 'react'
import type {
  ComponentType,
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  SVGProps,
} from 'react'
import {
  Boxes,
  Copy,
  Globe,
  Layers,
  Plus,
  Search,
  Swords,
  User,
  Users,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { MnlMod } from '@/domain/entities/manualBuffs.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { AttributeKey } from '@/domain/entities/stats.ts'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay.ts'
import { skllTypeDspl } from '@/domain/gameData/skillTypes.ts'
import { getWpnById } from '@/data/catalog/weaponCatalogService.ts'
import { echoStatIconSrc } from '@/modules/simulation/features/echoes/lib/statGlyph.tsx'
import { withDefEchoMg, withDefIconM, withDefWpnMg } from '@/shared/lib/imageFallback.ts'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import type { AppModalState } from '@/shared/ui/AppModal.tsx'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'
import { Select } from '@/application/ui/Select'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import { RichDscr } from '@/modules/simulation/ui/RichDescription.tsx'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { resPssvPrms } from '@/modules/simulation/features/weapons/lib/weapon.ts'
import { useSel } from '@/modules/simulation/lib/sel.tsx'
import type { SelAct } from '@/modules/simulation/lib/sel.tsx'
import {
  cloneMnlMdfr,
  makeModClip,
  writeMnlModC,
} from './lib/clipboard.ts'
import EchoSourceIcon from '@/assets/echo.svg?react'
import {
  getBuffPresetEntryCtx,
  getBuffPresetPaneCtx,
} from '@/modules/simulation/features/buffs/lib/ctx.tsx'
import {
  buildBuffPresetCatalog,
  buffTypeLabel,
  describeManualModifier,
  presetToManualModifiers,
} from './lib/presets.ts'
import type {
  BuffPresetEntry,
  BuffPresetSourceKind,
  BuffPresetType,
  BuffPresetValues,
} from './lib/presets.ts'

interface BuffPresetModalProps {
  state: AppModalState
  runtime: ResRuntime
  onClose: (onClosed?: () => void) => void
  onAdd: (modifiers: MnlMod[]) => void
}

type SourceFilter = 'all' | BuffPresetSourceKind
type BuffTypeFilter = 'all' | BuffPresetType

const SOURCE_FILTER_VALUES = ['all', 'echo', 'echoSet', 'weapon'] as const satisfies readonly SourceFilter[]
const BUFF_TYPE_FILTER_VALUES = ['all', 'self', 'active', 'team'] as const satisfies readonly BuffTypeFilter[]
const BUFF_PRESET_FILTERS_STORAGE_KEY = 'wwcalc.buff-preset-filters'

interface RailOption<T extends string> {
  value: T
  label: string
  icon: LucideIcon | ComponentType<SVGProps<SVGSVGElement>>
}

const SOURCE_KIND_OPTIONS: Array<RailOption<SourceFilter>> = [
  { value: 'all', label: 'All', icon: Layers },
  { value: 'echo', label: 'Echoes', icon: EchoSourceIcon },
  { value: 'echoSet', label: 'Sets', icon: Boxes },
  { value: 'weapon', label: 'Weapons', icon: Swords },
]

const BUFF_TYPE_OPTIONS: Array<RailOption<BuffTypeFilter>> = [
  { value: 'all', label: 'Any', icon: Globe },
  { value: 'self', label: 'Self', icon: User },
  { value: 'active', label: 'Active', icon: Zap },
  { value: 'team', label: 'Team', icon: Users },
]

const BUFF_TYPE_ICONS: Record<BuffPresetType, LucideIcon> = {
  self: User,
  active: Zap,
  team: Users,
}

const RANK_STEPS = [1, 2, 3, 4, 5]
const FOOT_WELL_LIMIT = 9

const ECHO_SOURCE_ICON = '/assets/echo.svg'

function isSourceFilter(value: unknown): value is SourceFilter {
  return typeof value === 'string' && SOURCE_FILTER_VALUES.includes(value as SourceFilter)
}

function isBuffTypeFilter(value: unknown): value is BuffTypeFilter {
  return typeof value === 'string' && BUFF_TYPE_FILTER_VALUES.includes(value as BuffTypeFilter)
}

function readPersistedFilters(): { sourceKind: SourceFilter; buffType: BuffTypeFilter } {
  if (typeof window === 'undefined') {
    return { sourceKind: 'all', buffType: 'all' }
  }

  try {
    const raw = window.localStorage.getItem(BUFF_PRESET_FILTERS_STORAGE_KEY)
    if (!raw) {
      return { sourceKind: 'all', buffType: 'all' }
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      sourceKind: isSourceFilter(parsed.sourceKind) ? parsed.sourceKind : 'all',
      buffType: isBuffTypeFilter(parsed.buffType) ? parsed.buffType : 'all',
    }
  } catch {
    return { sourceKind: 'all', buffType: 'all' }
  }
}

function persistFilters(sourceKind: SourceFilter, buffType: BuffTypeFilter): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      BUFF_PRESET_FILTERS_STORAGE_KEY,
      JSON.stringify({ sourceKind, buffType }),
    )
  } catch {
    // persistence is best-effort; filter controls should remain usable if storage is unavailable.
  }
}

function kindLabel(kind: BuffPresetSourceKind): string {
  if (kind === 'echoSet') return 'Set'
  if (kind === 'weapon') return 'Weapon'
  return 'Echo'
}

function entryValues(
    entry: BuffPresetEntry,
    controlValues: Record<string, BuffPresetValues>,
): BuffPresetValues {
  const stored = controlValues[entry.id] ?? {}
  return Object.fromEntries(
    entry.controls.map((control) => [control.key, stored[control.key] ?? control.defaultValue]),
  )
}

function visibleControls(entry: BuffPresetEntry) {
  return entry.controls.filter((control) => control.kind !== 'toggle')
}

function entryRank(entry: BuffPresetEntry, rankValues: Record<string, number>): number {
  return entry.source.type === 'weapon' ? rankValues[entry.id] ?? 1 : 1
}

function entryDescriptionParams(entry: BuffPresetEntry, rank: number): Array<string | number> | undefined {
  if (entry.source.type !== 'weapon') {
    return entry.descriptionParams
  }

  const weapon = getWpnById(entry.source.id)
  return weapon ? resPssvPrms(weapon.passive.params, rank) : entry.descriptionParams
}

function entryImageFallback(entry: BuffPresetEntry) {
  if (entry.source.type === 'weapon') return withDefWpnMg
  if (entry.source.type === 'echo') return withDefEchoMg
  return withDefIconM
}

function entryIcon(entry: BuffPresetEntry): string | null {
  return entry.sourceIcon ?? (entry.source.type === 'echo' ? ECHO_SOURCE_ICON : null)
}

function searchableText(entry: BuffPresetEntry): string {
  return [
    entry.sourceName,
    entry.label,
    entry.effectName,
    entry.description,
    kindLabel(entry.source.type),
    buffTypeLabel(entry.buffType),
    ...entry.controls.map((control) => control.label),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function matchesFilters(
    entry: BuffPresetEntry,
    sourceKind: SourceFilter,
    buffType: BuffTypeFilter,
    query: string,
): boolean {
  if (sourceKind !== 'all' && entry.source.type !== sourceKind) return false
  if (buffType !== 'all' && entry.buffType !== buffType) return false
  if (query && !searchableText(entry).includes(query)) return false
  return true
}

const ATTRIBUTE_GLYPHS = new Set(['aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc', 'physical'])

function modifierGlyph(modifier: MnlMod): { icon: string; tint?: string } | null {
  if (modifier.scope === 'baseStat' || modifier.scope === 'topStat') {
    const icon = echoStatIconSrc(modifier.stat)
    return icon ? { icon } : null
  }

  if (modifier.scope === 'attribute') {
    if (!ATTRIBUTE_GLYPHS.has(modifier.attribute)) return null
    return {
      icon: `/assets/game/stats/icons/${modifier.attribute}.png`,
      tint: ATTR_COLORS[modifier.attribute as AttributeKey],
    }
  }

  const skillType = modifier.scope === 'skillType' || modifier.scope === 'skill'
    ? modifier.skillType
    : undefined
  const icon = skillType ? skllTypeDspl[skillType]?.icon : undefined
  return icon ? { icon } : null
}

function ModifierGlyph({ modifier }: { modifier: MnlMod }) {
  const glyph = modifierGlyph(modifier)
  if (!glyph) return <span className="bp-star bp-star--quiet" aria-hidden="true" />

  return (
    <span
      className="bp-glyph"
      aria-hidden="true"
      style={{
        WebkitMaskImage: `url("${glyph.icon}")`,
        maskImage: `url("${glyph.icon}")`,
        ...(glyph.tint ? { '--bp-glyph-tint': glyph.tint } : null),
      } as CSSProperties}
    />
  )
}

interface RankDialProps {
  label: string
  value: number
  onChange: (rank: number) => void
}

function RankDial({ label, value, onChange }: RankDialProps) {
  return (
    <div className="bp-dial">
      <div
        className="bp-dial__track"
        role="radiogroup"
        aria-label={label}
        style={{ '--bp-dial-lit': (value - 1) / (RANK_STEPS.length - 1) } as CSSProperties}
      >
        <span className="bp-dial__rule" aria-hidden="true" />
        <span className="bp-dial__lit" aria-hidden="true" />
        {RANK_STEPS.map((step) => (
          <button
            key={step}
            type="button"
            role="radio"
            aria-checked={step === value}
            aria-label={`${label} R${step}`}
            className={[
              'bp-dial__node',
              step <= value ? 'lit' : '',
              step === value ? 'current' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => onChange(step)}
          >
            <span className="bp-star" aria-hidden="true" />
          </button>
        ))}
      </div>
      <span className="bp-dial__read">R{value}</span>
    </div>
  )
}

interface StepperProps {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}

function Stepper({ label, value, min, max, onChange }: StepperProps) {
  return (
    <div className="bp-step" role="group" aria-label={label} title={label}>
      <button
        type="button"
        aria-label={`Fewer ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        &minus;
      </button>
      <b>{value}</b>
      <span>/{max}</span>
      <button
        type="button"
        aria-label={`More ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  )
}

interface RailGroupProps<T extends string> {
  title: string
  value: T
  options: Array<RailOption<T>>
  counts: Record<T, number>
  onChange: (value: T) => void
}

function RailGroup<T extends string>({ title, value, options, counts, onChange }: RailGroupProps<T>) {
  return (
    <div className="bp-rail__group" role="radiogroup" aria-label={title}>
      <h3 className="bp-rail__title">{title}</h3>
      {options.map((option) => {
        const Icon = option.icon
        const isActive = option.value === value
        const count = counts[option.value] ?? 0

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            className="bp-rail__opt"
            disabled={!isActive && count === 0}
            onClick={() => onChange(option.value)}
          >
            <Icon width="0.85rem" height="0.85rem" aria-hidden="true" />
            <span>{option.label}</span>
            <b>{count}</b>
          </button>
        )
      })}
    </div>
  )
}

export function BuffPresetModal({
  state,
  runtime,
  onClose,
  onAdd,
}: BuffPresetModalProps) {
  const catalog = useMemo(() => buildBuffPresetCatalog(), [])
  const initialFilters = useMemo(() => readPersistedFilters(), [])
  const [query, setQuery] = useState('')
  const [sourceKind, setSourceKind] = useState<SourceFilter>(initialFilters.sourceKind)
  const [buffType, setBuffType] = useState<BuffTypeFilter>(initialFilters.buffType)
  const [controlValues, setControlValues] = useState<Record<string, BuffPresetValues>>({})
  const [rankValues, setRankValues] = useState<Record<string, number>>({})
  const [pendingModifiers, setPendingModifiers] = useState<MnlMod[]>([])
  const showToast = useTstStr((store) => store.show)

  const setPersistedSourceKind = useCallback((value: SourceFilter) => {
    setSourceKind(value)
  }, [])

  const setPersistedBuffType = useCallback((value: BuffTypeFilter) => {
    setBuffType(value)
  }, [])
  const close = useCallback(() => {
    onClose(() => {
      persistFilters(sourceKind, buffType)
      if (pendingModifiers.length > 0) onAdd(pendingModifiers)
      setPendingModifiers([])
    })
  }, [buffType, onAdd, onClose, pendingModifiers, sourceKind])

  const previews = useMemo(() => {
    const next = new Map<string, MnlMod[]>()

    // preview rows are the source of truth for whether a preset can be selected
    // or copied, so evaluate them once per control/rank state change.
    for (const entry of catalog) {
      next.set(
        entry.id,
        presetToManualModifiers(
          entry,
          runtime,
          entryValues(entry, controlValues),
          entryRank(entry, rankValues),
        ),
      )
    }

    return next
  }, [catalog, controlValues, rankValues, runtime])

  const normalizedQuery = query.trim().toLowerCase()

  const filtered = useMemo(
    () => catalog.filter((entry) => matchesFilters(entry, sourceKind, buffType, normalizedQuery)),
    [buffType, catalog, normalizedQuery, sourceKind],
  )

  // each group count applies the opposite group and search predicates first.
  const railCounts = useMemo(() => {
    const source = { all: 0, echo: 0, echoSet: 0, weapon: 0 } satisfies Record<SourceFilter, number>
    const type = { all: 0, self: 0, active: 0, team: 0 } satisfies Record<BuffTypeFilter, number>

    for (const entry of catalog) {
      if (matchesFilters(entry, 'all', buffType, normalizedQuery)) {
        source.all += 1
        source[entry.source.type] += 1
      }
      if (matchesFilters(entry, sourceKind, 'all', normalizedQuery)) {
        type.all += 1
        type[entry.buffType] += 1
      }
    }

    return { source, type }
  }, [buffType, catalog, normalizedQuery, sourceKind])

  const filtersActive = sourceKind !== 'all' || buffType !== 'all' || normalizedQuery.length > 0

  const resetFilters = useCallback(() => {
    setSourceKind('all')
    setBuffType('all')
    setQuery('')
  }, [])

  const visiblePresetIds = useMemo(
    () => filtered.map((entry) => entry.id),
    [filtered],
  )

  const selectablePresetIds = useMemo(
    () => filtered
      .filter((entry) => (previews.get(entry.id)?.length ?? 0) > 0)
      .map((entry) => entry.id),
    [filtered, previews],
  )

  const selectionItems = useMemo(
    () => filtered.map((entry) => ({ id: entry.id, val: entry })),
    [filtered],
  )

  const copyPresetModifiers = useCallback(async (modifiers: MnlMod[]) => {
    if (modifiers.length === 0) {
      return false
    }

    const wrote = await writeMnlModC(
      makeModClip(cloneMnlMdfr(modifiers)),
    )

    showToast({
      content: wrote
        ? (modifiers.length === 1 ? 'Copied 1 preset modifier.' : `Copied ${modifiers.length} preset modifiers.`)
        : 'Could not write preset modifiers to clipboard.',
      variant: wrote ? 'success' : 'warning',
      duration: wrote ? 2200 : 3200,
    })

    return wrote
  }, [showToast])

  const copyPresetEntries = useCallback((entries: BuffPresetEntry[]) => (
    copyPresetModifiers(entries.flatMap((entry) => previews.get(entry.id) ?? []))
  ), [copyPresetModifiers, previews])

  const selectionActions = useMemo<Array<SelAct<string, BuffPresetEntry>>>(() => [
    {
      id: 'copy',
      label: 'Copy',
      key: 'copy',
      needsSel: true,
      float: false,
      run: ({ vals }) => {
        void copyPresetEntries(vals)
      },
    },
  ], [copyPresetEntries])

  const presetSelection = useSel<string, BuffPresetEntry>({
    surfaceId: 'buff-preset-modal',
    ariaLabel: 'Buff preset selection',
    items: selectionItems,
    ord: visiblePresetIds,
    av: selectablePresetIds,
    acts: selectionActions,
    bar: false,
  })

  const selectedEntries = presetSelection.selectedVals

  const selectedModifiers = useMemo(
    () => selectedEntries.flatMap((entry) => previews.get(entry.id) ?? []),
    [previews, selectedEntries],
  )

  const resolveEntryContextTarget = useCallback((entry: BuffPresetEntry) => {
    // context-menu actions operate on the whole current selection when the
    // clicked preset is already selected, matching shared selection behavior.
    if (
      presetSelection.selectionMode &&
      presetSelection.selectedIdSet.has(entry.id) &&
      selectedEntries.length > 0
    ) {
      return {
        entries: selectedEntries,
        modifiers: selectedModifiers,
      }
    }

    return {
      entries: [entry],
      modifiers: previews.get(entry.id) ?? [],
    }
  }, [
    presetSelection.selectedIdSet,
    presetSelection.selectionMode,
    previews,
    selectedEntries,
    selectedModifiers,
  ])

  const setControlValue = useCallback((
      entryId: string,
      key: string,
      value: boolean | number | string,
  ) => {
    setControlValues((previous) => ({
      ...previous,
      [entryId]: {
        ...previous[entryId],
        [key]: value,
      },
    }))
  }, [])

  const setRankValue = useCallback((entryId: string, rank: number) => {
    setRankValues((previous) => ({
      ...previous,
      [entryId]: rank,
    }))
  }, [])

  const addSelected = useCallback(() => {
    if (selectedModifiers.length === 0) return
    setPendingModifiers((current) => [
      ...current,
      ...cloneMnlMdfr(selectedModifiers),
    ])
    presetSelection.exitSelectionMode()
  }, [presetSelection, selectedModifiers])

  const addPresetModifiers = useCallback((modifiers: MnlMod[]) => {
    if (modifiers.length === 0) return
    setPendingModifiers((current) => [
      ...current,
      ...cloneMnlMdfr(modifiers),
    ])
  }, [])

  const copySelected = useCallback(() => {
    void copyPresetModifiers(selectedModifiers)
  }, [copyPresetModifiers, selectedModifiers])

  const selectEntry = useCallback((entry: BuffPresetEntry) => {
    if ((previews.get(entry.id)?.length ?? 0) === 0) return
    presetSelection.addToSelection(entry.id)
  }, [presetSelection, previews])

  const deselectEntry = useCallback((entry: BuffPresetEntry) => {
    if (!presetSelection.selectedIdSet.has(entry.id)) return
    presetSelection.toggleSelection(entry.id)
  }, [presetSelection])

  const buildEntryContextMenu = useCallback((entry: BuffPresetEntry) => {
    const target = resolveEntryContextTarget(entry)
    const entrySelected = presetSelection.selectedIdSet.has(entry.id)
    const entrySelectable = (previews.get(entry.id)?.length ?? 0) > 0

    // menu builders receive materialized targets so they do not need to know
    // about preview caches, selection state, or preset control values.
    return getBuffPresetEntryCtx({
      entry,
      target,
      entrySelected,
      entrySelectable,
      canSelectVisible: selectablePresetIds.length > 0,
      selectedCount: presetSelection.selectedCount,
      onAdd: addPresetModifiers,
      onCopy: copyPresetModifiers,
      onSelect: selectEntry,
      onDeselect: deselectEntry,
      onSelectVisible: presetSelection.selectAll,
      onClearSelection: presetSelection.exitSelectionMode,
    })
  }, [
    addPresetModifiers,
    copyPresetModifiers,
    deselectEntry,
    presetSelection,
    previews,
    resolveEntryContextTarget,
    selectablePresetIds.length,
    selectEntry,
  ])

  const buildModalContextMenu = useCallback(() => getBuffPresetPaneCtx({
    selectedModifiers,
    canSelectVisible: selectablePresetIds.length > 0,
    selectedCount: presetSelection.selectedCount,
    onAddSelected: addSelected,
    onCopySelected: copySelected,
    onSelectVisible: presetSelection.selectAll,
    onClearSelection: presetSelection.exitSelectionMode,
  }), [
    addSelected,
    copySelected,
    presetSelection,
    selectablePresetIds.length,
    selectedModifiers,
  ])

  const ignoreCardClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    return Boolean(
      target.closest('button, input, a, [role="listbox"], [role="radio"], .app-select'),
    )
  }, [])

  return (
    <AppModal
      state={state}
      variant="buff-presets"
      ariaLabel="Buff presets"
      onClose={close}
    >
      <div className="amdl bp-modal">
        <ModalHeader over="Manual Buffs" title={<h2>Buff Presets</h2>} onClose={close}>
          <label className="amdl__find bp-find">
            <Search size="0.85rem" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search buffs, sources, effects"
              aria-label="Search presets"
            />
          </label>
          <div className="amdl__gauge" aria-label="Preset counts">
            <div className="amdl__pill">
              <span className="amdl__pill-label">Shown</span>
              <span className="amdl__pill-value">{filtered.length}</span>
            </div>
            <div className="amdl__pill is-accent">
              <span className="amdl__pill-label">Selected</span>
              <span className="amdl__pill-value">{presetSelection.selectedCount}</span>
            </div>
          </div>
        </ModalHeader>

        <div className="bp-body">
          <aside className="bp-rail" aria-label="Preset filters">
            <RailGroup
              title="Source"
              value={sourceKind}
              options={SOURCE_KIND_OPTIONS}
              counts={railCounts.source}
              onChange={setPersistedSourceKind}
            />
            <RailGroup
              title="Reach"
              value={buffType}
              options={BUFF_TYPE_OPTIONS}
              counts={railCounts.type}
              onChange={setPersistedBuffType}
            />
            <div className="bp-rail__foot">
              <span><b>{filtered.length}</b> of {catalog.length} shown</span>
              {filtersActive ? (
                <button type="button" className="bp-rail__reset" onClick={resetFilters}>
                  Reset filters
                </button>
              ) : null}
            </div>
          </aside>

          <ContextTrigger
            asChild
            ariaLabel="Buff preset list actions"
            getItems={buildModalContextMenu}
          >
            <div className="bp-list" {...presetSelection.surfaceProps}>
              {filtered.length > 0 ? (
                <>
                  <div className="bp-cols bp-list__head" aria-hidden="true">
                    <span />
                    <span />
                    <span>Source</span>
                    <span>Reach</span>
                    <span>Adds</span>
                    <span className="bp-list__head-end">Settings</span>
                  </div>
                  <div role="list">
                    {filtered.map((entry) => {
                      const rank = entryRank(entry, rankValues)
                      const values = entryValues(entry, controlValues)
                      const modifiers = previews.get(entry.id) ?? []
                      const isSelectable = modifiers.length > 0
                      const isSelected = presetSelection.selectedIdSet.has(entry.id)
                      const descriptionParams = entryDescriptionParams(entry, rank)
                      const controls = visibleControls(entry)
                      const isWeapon = entry.source.type === 'weapon'
                      const sourceIcon = entryIcon(entry)
                      const ReachIcon = BUFF_TYPE_ICONS[entry.buffType]

                      return (
                        <ContextTrigger
                          key={entry.id}
                          asChild
                          ariaLabel={`${entry.sourceName} preset actions`}
                          items={buildEntryContextMenu(entry)}
                        >
                          <article
                            role="listitem"
                            className={[
                              'bp-row',
                              'bp-cols',
                              isSelected ? 'is-selected focus-selected' : '',
                              isSelectable ? '' : 'is-empty',
                            ].filter(Boolean).join(' ')}
                            data-selection-focus-item="true"
                            aria-selected={isSelected ? 'true' : 'false'}
                            onClickCapture={presetSelection.buildClickCapture(entry.id, {
                              active: isSelectable,
                              shouldIgnore: ignoreCardClick,
                            })}
                            onClick={(event) => {
                              if (ignoreCardClick(event)) return
                              presetSelection.addToSelection(entry.id)
                            }}
                          >
                            <span className="bp-row__mark" aria-hidden="true">
                              <span className="bp-star" />
                            </span>

                            <span className="bp-row__icon" aria-hidden="true">
                              {sourceIcon ? (
                                <DisplayImage
                                  src={sourceIcon}
                                  alt=""
                                  loading="lazy"
                                  onError={entryImageFallback(entry)}
                                />
                              ) : (
                                <span>{kindLabel(entry.source.type).slice(0, 1)}</span>
                              )}
                            </span>

                            <div className="bp-row__source">
                              <h3>
                                <span className="bp-row__name">{entry.sourceName}</span>
                                <span className="bp-row__kind">{kindLabel(entry.source.type)}</span>
                              </h3>
                              {entry.description ? (
                                <RichDscr
                                  description={entry.description}
                                  params={descriptionParams}
                                  className="bp-row__desc"
                                />
                              ) : <p className="bp-row__desc">{entry.label}</p>}
                            </div>

                            <span className={`bp-reach bp-reach--${entry.buffType}`}>
                              <ReachIcon size="0.72rem" aria-hidden="true" />
                              {buffTypeLabel(entry.buffType)}
                            </span>

                            <ul className="bp-adds" aria-label="Generated modifiers">
                              {isSelectable ? modifiers.map((modifier, modIndex) => {
                                const preview = describeManualModifier(modifier)
                                return (
                                  <li key={`${modifier.scope}-${modIndex}`}>
                                    <ModifierGlyph modifier={modifier} />
                                    <span className="bp-adds__label" title={preview.label}>{preview.label}</span>
                                    <i className="bp-adds__lead" aria-hidden="true" />
                                    <b>{preview.value}</b>
                                  </li>
                                )
                              }) : (
                                <li className="bp-adds__none">No modifier at these settings</li>
                              )}
                            </ul>

                            <div className="bp-row__settings">
                              {isWeapon ? (
                                <RankDial
                                  label={`${entry.sourceName} rank`}
                                  value={rank}
                                  onChange={(nextRank) => setRankValue(entry.id, nextRank)}
                                />
                              ) : null}
                              {controls.map((control) => {
                                if (control.kind === 'select' && control.options) {
                                  return (
                                    <Select
                                      key={control.key}
                                      value={String(values[control.key])}
                                      options={control.options.map((option) => ({
                                        value: option.id,
                                        label: option.label,
                                      }))}
                                      onChange={(value) => setControlValue(entry.id, control.key, value)}
                                      ariaLabel={control.label}
                                      className="bp-row__select"
                                    />
                                  )
                                }

                                const value = Number(values[control.key] ?? 0)
                                if (control.min !== undefined && control.max !== undefined) {
                                  return (
                                    <Stepper
                                      key={control.key}
                                      label={control.label}
                                      value={value}
                                      min={control.min}
                                      max={control.max}
                                      onChange={(next) => setControlValue(entry.id, control.key, next)}
                                    />
                                  )
                                }

                                return (
                                  <input
                                    key={control.key}
                                    type="number"
                                    className="bp-row__number"
                                    aria-label={control.label}
                                    title={control.label}
                                    value={value}
                                    min={control.min}
                                    max={control.max}
                                    onChange={(event) => {
                                      const nextValue = Number(event.target.value)
                                      setControlValue(
                                        entry.id,
                                        control.key,
                                        Number.isFinite(nextValue) ? nextValue : control.defaultValue,
                                      )
                                    }}
                                  />
                                )
                              })}
                            </div>
                          </article>
                        </ContextTrigger>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className="bp-empty">
                  <Search size="1.1rem" aria-hidden="true" />
                  <strong>No presets match</strong>
                  <span>Clear the search or reset the filters.</span>
                </div>
              )}
            </div>
          </ContextTrigger>
        </div>

        <footer className="amdl__foot bp-foot">
          <div className="bp-wells">
            <span className="bp-wells__lead">
              {selectedEntries.length > 0
                ? <><b>{selectedEntries.length}</b> picked</>
                : 'Pick presets'}
            </span>
            {selectedEntries.length > 0 ? (
              <>
                {selectedEntries.slice(0, FOOT_WELL_LIMIT).map((entry) => {
                  const icon = entryIcon(entry)
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className="bp-well"
                      title={`Remove ${entry.sourceName}`}
                      aria-label={`Remove ${entry.sourceName}`}
                      onClick={() => deselectEntry(entry)}
                    >
                      {icon ? (
                        <DisplayImage src={icon} alt="" onError={entryImageFallback(entry)} />
                      ) : null}
                    </button>
                  )
                })}
                {selectedEntries.length > FOOT_WELL_LIMIT ? (
                  <span className="bp-well bp-well--more">+{selectedEntries.length - FOOT_WELL_LIMIT}</span>
                ) : null}
              </>
            ) : (
              <>
                <span className="bp-well bp-well--ghost" aria-hidden="true" />
                <span className="bp-well bp-well--ghost" aria-hidden="true" />
                <span className="bp-well bp-well--ghost" aria-hidden="true" />
              </>
            )}
          </div>

          <div className="bp-foot__acts">
            <button type="button" className="amdl__act" onClick={presetSelection.selectAll}>
              Select visible
            </button>
            <button
              type="button"
              className="amdl__act"
              onClick={presetSelection.exitSelectionMode}
              disabled={presetSelection.selectedCount === 0}
            >
              Clear
            </button>
            <button
              type="button"
              className="amdl__act"
              onClick={copySelected}
              disabled={selectedModifiers.length === 0}
            >
              <Copy size="0.8rem" aria-hidden="true" />
              Copy
            </button>
            <button
              type="button"
              className="amdl__act is-go"
              onClick={addSelected}
              disabled={selectedModifiers.length === 0}
            >
              <Plus size="0.8rem" aria-hidden="true" />
              {selectedModifiers.length > 0
                ? `Add ${selectedModifiers.length} ${selectedModifiers.length === 1 ? 'modifier' : 'modifiers'}`
                : 'Add selected'}
            </button>
          </div>
        </footer>
      </div>
    </AppModal>
  )
}
