/*
  Author: Runor Ewhro
  description: filters resonator catalog entries and returns a selected resonator identity.
*/

import { DisplayImage } from '@/shared/ui/DisplayImage'
import { ensureResonatorData } from '@/data/gameData'
import { useTstStr } from '@/shared/util/toastStore'
import {type CSSProperties as CssProps, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type { ReactNode } from 'react'
import { Check, Flame, History } from 'lucide-react'
import type { ResMenuEnt } from '@/domain/entities/resonator.ts'
import { useAppStore } from '@/application/state'
import {
  ATTR_FILTERS,
  WEAPON_FILTERS,
  WPNTYPETOKEY,
} from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { toTitle } from '@/shared/lib/format.ts'
import { withDefIconM, withPickerImageFallback } from '@/shared/lib/imageFallback.ts'
import { PickerModal as ShrdPckrMdl, type PckrMdlItem } from '@/modules/simulation/ui/PickerModal.tsx'
import { useResQStr } from '@/shared/util/resonatorQueueStore.ts'
import {
  getRecs,
  orderRecs,
} from '@/modules/simulation/features/resonator/lib/recommendations.ts'
import { ATTR_COLORS, rarityVars } from '@/modules/simulation/model/display.ts'
import { roverIsVisible } from '@/domain/entities/roverGender'

const ALL_ROLE_ID = '__all_roles__'

interface RoleOption {
  value: string
  label: string
  icon: string
}

interface ResPckrPrps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  eyebrow?: string
  title: string
  closeLabel?: string
  panelWidth?: 'regular' | 'wide'
  resonators: ResMenuEnt[]
  selResId?: string | null
  selLbl?: string
  smmrPrmr?: {
    label: string
    value: string | number
  }
  countLabel?: string
  emptyState?: ReactNode
  onSelect: (resonatorId: string) => void
  onClose: () => void
}

export function usePickerFilters() {
  const [selWpnFltr, setSelWpnFlt] = useState<string | null>(null)
  const [selTtrbFltr, setSelTtrbFl] = useState<string | null>(null)
  const [selRoleFltr, setSelRoleFl] = useState<string>(ALL_ROLE_ID)
  const [rarityFilter, setSelRrtyFl] = useState<number[]>([4, 5])
  return { selWpnFltr, setSelWpnFlt, selTtrbFltr, setSelTtrbFl, selRoleFltr, setSelRoleFl, rarityFilter, setSelRrtyFl }
}

export function ResPckr(props: ResPckrPrps) {
  // preserve filter choices between openings without subscribing to the store
  // or building every card while this picker is closed.
  const filters = usePickerFilters()
  return props.visible && props.portalTarget
    ? <ResPickerContent {...props} filterState={filters} />
    : null
}

function ResPickerContent({
  visible,
  open,
  closing = false,
  portalTarget,
  eyebrow,
  title,
  closeLabel,
  panelWidth = 'regular',
  resonators,
  selResId = null,
  selLbl = 'Selected',
  smmrPrmr,
  countLabel = 'Roster',
  emptyState,
  onSelect,
  onClose,
  filterState,
}: ResPckrPrps & { filterState: ReturnType<typeof usePickerFilters> }) {
  const view = useResPickerView({ resonators, selResId, selLbl, smmrPrmr, closing, onSelect, filterState })

  return (
    <ShrdPckrMdl
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      variant="resonator"
      eyebrow={eyebrow}
      title={title}
      summary={view.summary}
      filters={view.filters}
      railFoot={`${view.shown} of ${view.total} ${countLabel.toLowerCase()}`}
      items={view.items}
      emptyState={emptyState}
      closeLabel={closeLabel}
      panelWidth={panelWidth}
      onClose={onClose}
    />
  )
}

// callers that commit immediately preload the selected resonator before invoking
// onSelect. staged callers defer that work until their aggregate commit.
export function useResPickerView({
  resonators,
  selResId = null,
  selLbl: slctLbl = 'Selected',
  smmrPrmr,
  closing = false,
  preload = true,
  onSelect,
  filterState,
}: {
  resonators: ResMenuEnt[]
  selResId?: string | null
  selLbl?: string
  smmrPrmr?: ResPckrPrps['smmrPrmr']
  closing?: boolean
  preload?: boolean
  onSelect: (resonatorId: string) => void
  filterState: ReturnType<typeof usePickerFilters>
}) {
  const selectionRequest = useRef(0)
  const cancelSelection = useCallback(() => { selectionRequest.current++ }, [])
  useEffect(() => cancelSelection, [cancelSelection])
  useEffect(() => { if (closing) cancelSelection() }, [closing, cancelSelection])
  const rcmmMenuTms = useAppStore((state) => state.ui.preferences.recommendedMenuItems)
  const roverGender = useAppStore((state) => state.ui.preferences.roverGender)
  const frqnResBkt = useAppStore((state) => state.ui.itemFreq.resonator)
  const lastUsedResI = useResQStr((state) => state.queueIds)

  const { selWpnFltr, setSelWpnFlt, selTtrbFltr, setSelTtrbFl, selRoleFltr, setSelRoleFl, rarityFilter, setSelRrtyFl } = filterState

  const visibleResonators = useMemo(
    () => resonators.filter((entry) => roverIsVisible(entry.id, roverGender)),
    [resonators, roverGender],
  )

  const roleOptions = useMemo<RoleOption[]>(() => {
    const roleMap = new Map<string, RoleOption>()

    for (const entry of visibleResonators) {
      for (const tag of entry.tags ?? []) {
        if (!roleMap.has(tag.id)) {
          roleMap.set(tag.id, {
            value: tag.id,
            label: tag.name,
            icon: `/assets/game/resonators/tags/${tag.id}.webp`,
          })
        }
      }
    }

    return Array.from(roleMap.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [visibleResonators])

  const frqnResIds = frqnResBkt.order
  const frqnResCnts = useMemo(
    () => Object.fromEntries(
      Object.entries(frqnResBkt.items).map(([id, item]) => [id, item.count]),
    ),
    [frqnResBkt.items],
  )

  const fltrRsnt = useMemo(() => {
    return visibleResonators.filter((entry) => {
      const mtchWpn =
        selWpnFltr === null || WPNTYPETOKEY[entry.weaponType] === selWpnFltr
      const mtchTtrb =
        selTtrbFltr === null || entry.attribute === selTtrbFltr
      const mtchRole =
        selRoleFltr === ALL_ROLE_ID || Boolean(entry.tags?.some((tag) => tag.id === selRoleFltr))
      const mtchRrty = rarityFilter.includes(entry.rarity)

      return mtchWpn && mtchTtrb && mtchRole && mtchRrty
    })
  }, [visibleResonators, selRoleFltr, selTtrbFltr, rarityFilter, selWpnFltr])

  const actFltrCnt =
    Number(selWpnFltr !== null) +
    Number(selTtrbFltr !== null) +
    Number(selRoleFltr !== ALL_ROLE_ID) +
    Number(rarityFilter.length !== 2)

  const summary = (
    <>
      {smmrPrmr ? (
        <div className="amdl__pill">
          <span className="amdl__pill-label">{smmrPrmr.label}</span>
          <span className="amdl__pill-value">{smmrPrmr.value}</span>
        </div>
      ) : null}
      {actFltrCnt > 0 ? (
        <div className="amdl__pill">
          <span className="amdl__pill-label">Filters</span>
          <span className="amdl__pill-value">{actFltrCnt}</span>
        </div>
      ) : null}
    </>
  )

  const filters = (
    <>
      <div className="pkr-rail__lab">Rarity</div>
      <div className="pkr-rail__row">
        {[5, 4].map((rarity) => (
          <button
            key={`rarity-${rarity}`}
            type="button"
            className={rarityFilter.includes(rarity) ? 'pkr-rail__chip is-on' : 'pkr-rail__chip'}
            style={rarityVars(rarity, '--pkr-tone') as CssProps}
            aria-pressed={rarityFilter.includes(rarity)}
            onClick={() =>
              setSelRrtyFl((prev) =>
                prev.includes(rarity) ? prev.filter((value) => value !== rarity) : [...prev, rarity],
              )
            }
          >
            {rarity}★
          </button>
        ))}
      </div>

      <div className="pkr-rail__lab">Weapon</div>
      <div className="pkr-rail__row">
        {WEAPON_FILTERS.map((weapon) => (
          <button
            key={`weapon-${weapon.key}`}
            type="button"
            className={
              selWpnFltr === weapon.key
                ? 'pkr-rail__ico picker-filter-icon--theme-contrast is-on'
                : 'pkr-rail__ico picker-filter-icon--theme-contrast'
            }
            title={weapon.label}
            aria-label={weapon.label}
            aria-pressed={selWpnFltr === weapon.key}
            onClick={() => setSelWpnFlt((prev) => (prev === weapon.key ? null : weapon.key))}
          >
            <DisplayImage src={`/assets/game/weapons/types/${weapon.key}.webp`} alt="" aria-hidden="true" onError={withDefIconM} />
          </button>
        ))}
      </div>

      <div className="pkr-rail__lab">Element</div>
      <div className="pkr-rail__row">
        {ATTR_FILTERS.map((attribute) => (
          <button
            key={`attribute-${attribute}`}
            type="button"
            className={selTtrbFltr === attribute ? 'pkr-rail__ico is-on' : 'pkr-rail__ico'}
            style={{ '--pkr-tone': ATTR_COLORS[attribute] } as CssProps}
            title={toTitle(attribute)}
            aria-label={toTitle(attribute)}
            aria-pressed={selTtrbFltr === attribute}
            onClick={() => setSelTtrbFl((prev) => (prev === attribute ? null : attribute))}
          >
            <DisplayImage
              src={`/assets/game/attributes/icons/${attribute}.webp`}
              alt=""
              aria-hidden="true"
              style={attribute === 'physical' ? { filter: 'grayscale(1) brightness(0.6)' } : undefined}
              onError={withDefIconM}
            />
          </button>
        ))}
      </div>

      <div className="pkr-rail__lab">Role</div>
      <div className="pkr-rail__list">
        {roleOptions.map((option) => {
          const picked = selRoleFltr === option.value
          return (
            <button
              key={option.value}
              type="button"
              className={picked ? 'amdl__tab is-on' : 'amdl__tab'}
              aria-pressed={picked}
              onClick={() => setSelRoleFl((prev) => (prev === option.value ? ALL_ROLE_ID : option.value))}
            >
              <div className="pkr-rail__mark"
                aria-hidden="true"
                style={{
                  WebkitMaskImage: `url(${option.icon})`,
                  maskImage: `url(${option.icon})`,
                } as CssProps}
              />
              <span className="amdl__tab-label">{option.label}</span>
              {picked ? <Check size="0.7rem" /> : <span />}
            </button>
          )
        })}
      </div>
    </>
  )

  const rdrdRsnt = useMemo(
    () => orderRecs(
      fltrRsnt,
      rcmmMenuTms,
      lastUsedResI,
      frqnResIds,
      frqnResCnts,
    ),
    [
      fltrRsnt,
      frqnResCnts,
      frqnResIds,
      lastUsedResI,
      rcmmMenuTms,
    ],
  )

  const toItem = (entry: ResMenuEnt): PckrMdlItem => {
    const isSelected = entry.id === selResId
    const tags = entry.tags ?? []
    const rcmm = rcmmMenuTms
      ? getRecs(
          entry.id,
          lastUsedResI,
          frqnResIds,
          frqnResCnts,
        )
      : []
    const rcmmFrqn = rcmm.find((rcmmfg) => rcmmfg.kind === 'frequent')
    const rcmmLast = rcmm.find((rcmmfg) => rcmmfg.kind === 'last-active')
    const rcmmBadge = rcmm.length > 0
      ? (
          <>
            {rcmmFrqn ? (
              <span className="pkm__spec-item" title={rcmmFrqn.label}>
                <Flame size="0.75rem" />
                {frqnResCnts[entry.id] ?? 0}
              </span>
            ) : null}
            {rcmmLast ? (
              <span title={rcmmLast.label}>
                <History size="0.75rem" />
              </span>
            ) : null}
          </>
        )
      : null

    return {
      id: entry.id,
      title: entry.displayName,
      rarity: entry.rarity,
      selected: isSelected,
      onSelect: () => {
        if (!preload) {
          onSelect(entry.id)
          return
        }
        const request = ++selectionRequest.current
        void ensureResonatorData([entry.id]).then(() => {
          if (selectionRequest.current === request) onSelect(entry.id)
        }).catch((error: unknown) => {
          if (selectionRequest.current !== request) return
          useTstStr.getState().show({ content: error instanceof Error ? error.message : 'Could not load resonator data.', variant: 'error' })
        })
      },
      leading: (
        <div className="pkm__media-frame"
          style={rarityVars(entry.rarity) as CssProps}
        >
          <img
            data-deferred-src={entry.sprite}
            data-full-src={entry.sprite}
            loading="lazy"
            decoding="async"
            alt={entry.displayName} className="pkm__media-image"
            onError={withPickerImageFallback}
          />
        </div>
      ),
      tone: ATTR_COLORS[entry.attribute],
      trailing: isSelected && slctLbl ? slctLbl : rcmmBadge,
      meta: (
        <>
          <span className="pkm__spec-item pkm__spec-item--rarity">{entry.rarity}★</span>
          <DisplayImage
            src={`/assets/game/attributes/icons/${entry.attribute}.webp`}
            alt=""
            aria-hidden="true" className="pkm__meta-icon"
            title={toTitle(entry.attribute)}
            style={entry.attribute === 'physical' ? { filter: 'grayscale(1) brightness(0.6)' } : undefined}
            onError={withDefIconM}
          />
          <DisplayImage
            src={`/assets/game/weapons/types/${WPNTYPETOKEY[entry.weaponType]}.webp`}
            alt=""
            aria-hidden="true" className="pkm__meta-icon pkm__meta-icon--theme-contrast"
            title={toTitle(WPNTYPETOKEY[entry.weaponType])}
            onError={withDefIconM}
          />
          {tags.length > 0 ? (
            <span className="pkm__spec-group pkm__spec-push">
              {tags.slice(0, 3).map((tag) => (
                <div
                  key={tag.id}
                  title={tag.desc ? `${tag.name}: ${tag.desc}` : tag.name}
                  style={{
                    WebkitMaskImage: `url(/assets/game/resonators/tags/${tag.id}.webp)`,
                    maskImage: `url(/assets/game/resonators/tags/${tag.id}.webp)`,
                  } as CssProps} className="pkm__tag-icon"
                />
              ))}
            </span>
          ) : null}
        </>
      ),
    }
  }
  const items = rdrdRsnt.map(toItem)

  return { summary, filters, items, toItem, shown: fltrRsnt.length, total: visibleResonators.length, activeFilters: actFltrCnt }
}
