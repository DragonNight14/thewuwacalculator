/*
  Author: Runor Ewhro
  description: defines grouped settings preference models and small ui helpers
               for rendering the settings page preference cards.
*/

import { HIST_MAX_OPTS } from '@/domain/entities/appState'
import type { HistoryMax, UiState } from '@/domain/entities/appState'

export interface PrefSelPtn {
  value: HistoryMax
  label: string
}

export interface PrefSelItem {
  kind: 'select'
  value: HistoryMax
  options: PrefSelPtn[]
  onChange: (value: HistoryMax) => void
}

export interface PrefTglItem {
  kind: 'toggle'
  disabled?: boolean
  label: string
  description: string
  checked: boolean
  onChange?: (checked: boolean) => void
  child?: PrefSelItem
}

export interface PrefGrp {
  title: string
  description: string
  items: PrefTglItem[]
}

interface TglSwtcPrps {
  label: string
  description?: string
  checked?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
}

interface PrefSelBrncP {
  item: PrefSelItem
  open: boolean
}

interface MkPrefGrpsAr {
  ui: UiState
  setBlurMode: (checked: boolean) => void
  setNtrnAnim: (checked: boolean) => void
  setCtxMenu: (checked: boolean) => void
  setPdtTst: (checked: boolean) => void
  setGameBetaData: (checked: boolean) => void
  setRcmmMenyu: (checked: boolean) => void
  setMaxResInit: (checked: boolean) => void
  setHaveHist: (checked: boolean) => void
  setHistMax: (value: HistoryMax) => void
  setSeeQppd: (checked: boolean) => void
  setCmprXprts: (checked: boolean) => void
}

export function ToggleSwitch({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: TglSwtcPrps) {
  return (
    <button
      type="button"
      className={`settings-toggle ${disabled ? 'settings-toggle--disabled' : ''}`}
      onClick={() => onChange ? onChange(!checked) : null}
      disabled={disabled}
    >
      <div>
        <div>{label}</div>
        {description ? <div>{description}</div> : null}
      </div>
      <div className={`settings-switch ${checked ? 'settings-switch--on' : ''}`} />
    </button>
  )
}

export function PrefSelBrnc({
  item,
  open,
}: PrefSelBrncP) {
  return (
    <div className="settings-pref-branch"
      data-open={open ? 'true' : 'false'}
      role="radiogroup"
      aria-label="History stack"
      aria-hidden={!open}
    >
      <div>
        <div>
          {item.options.map((option) => {
            const selected = option.value === item.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={open ? 0 : -1}
                className={`settings-pref-branch__option${selected ? ' is-active' : ''}`}
                onClick={() => item.onChange(option.value)}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function mkPrefGrps({
  ui,
  setBlurMode,
  setNtrnAnim: setNtrnNmtn,
  setCtxMenu,
  setPdtTst: setPdtTst,
  setGameBetaData,
  setRcmmMenyu: setRcmmMenuT,
  setMaxResInit,
  setHaveHist: setHaveHstr,
  setHistMax: setHstrMax,
  setSeeQppd: setSeeQppd,
  setCmprXprts: setCmprXprts,
}: MkPrefGrpsAr): PrefGrp[] {
  return [
    {
      title: 'App',
      description: 'Interface behavior',
      items: [
        {
          kind: 'toggle',
          label: 'Glass Blur',
          description: 'Frosted-glass backdrop effects',
          checked: ui.blurMode,
          onChange: setBlurMode,
        },
        {
          kind: 'toggle',
          label: 'SOME Animations',
          description: 'Fade-in effects and some other animations',
          checked: ui.entranceAnimations,
          onChange: setNtrnNmtn,
        },
        {
          kind: 'toggle',
          label: 'In-App Context Menus',
          description: 'Show app action menus on supported surfaces',
          checked: ui.preferences.ctxMenu,
          onChange: setCtxMenu,
        },
        {
          kind: 'toggle',
          label: 'Update Toasts',
          description: 'Show a notification when an app update is available.',
          checked: ui.preferences.updateToast,
          onChange: setPdtTst,
        },
        {
          kind: 'toggle',
          label: 'Beta Game Data',
          description: 'Use beta game data catalogs. Changing this reloads the app.',
          checked: ui.preferences.gameBetaData,
          onChange: setGameBetaData,
        },
        {
          kind: 'toggle',
          label: 'Compressed Exports',
          description: 'Export files in the compact .wwcalc format.',
          checked: ui.compressedExports,
          onChange: setCmprXprts,
        },
        {
          kind: 'toggle',
          label: 'App History (Undo/Redo)',
          description: 'Enable undo/redo history for app actions.',
          checked: ui.haveHistory,
          onChange: setHaveHstr,
          child: {
            kind: 'select',
            value: ui.historyMax,
            options: HIST_MAX_OPTS.map((value) => ({
              value,
              label: String(value),
            })),
            onChange: setHstrMax,
          },
        },
      ],
    },
    {
      title: 'Calculator',
      description: 'Calculator behavior',
      items: [
        {
          kind: 'toggle',
          label: 'Show equipped by',
          description: 'Display the resonators using each echo in your inventory.',
          checked: ui.seeEquipped,
          onChange: setSeeQppd,
        },
        {
          kind: 'toggle',
          label: 'Recommended Menu Items',
          description: 'Have recommended menu items show first in menus.',
          checked: ui.preferences.recommendedMenuItems,
          onChange: setRcmmMenuT,
        },
        {
          kind: 'toggle',
          label: 'Max Resonators on Init',
          description: 'Initialize newly added or reset resonators at max level, skills, traces, sequence, and default max states.',
          checked: ui.preferences.maxResOnInit,
          onChange: setMaxResInit,
        },
      ],
    },
    {
      title: 'Other',
      description: 'Totally not sus or anything...',
      items: [
        {
          kind: 'toggle',
          label: 'Share your home address',
          description: 'Sorry non-negotiable, you can\'t toggle this but I promise i won\' tell anyone.',
          disabled: true,
          checked: true,
        },
      ],
    },
  ]
}
