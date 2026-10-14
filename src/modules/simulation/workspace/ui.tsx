/*
  Author: Runor Ewhro
  description: provides shared workspace glyph, stat, rating, and formatting primitives.
*/

import { DisplayImage } from '@/shared/ui/DisplayImage'
import { resolveDisplayImage } from '@/shared/lib/displayAssets'
import { currentPixelRatio } from '@/shared/lib/displayImageSizing'
import type { CSSProperties, KeyboardEvent, MouseEvent, RefCallback } from 'react'
import type { AttributeKey } from '@/domain/entities/stats'
import type { EchoInstance } from '@/domain/entities/runtime'
import type {
  EvaluationAlternative,
  EvaluationBuildKey,
  EvaluationEchoSlot,
  EvaluationSetSummary,
} from '@/engine/evaluation/buildEvaluation.ts'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import { ArrowUpFromLine, LibraryBig, Undo2 } from 'lucide-react'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'
import {
  EchoCardBand,
  EchoCardList,
  EchoCardRibbon,
  echoCardVars,
} from '@/modules/simulation/features/echoes/ui/EchoCard.tsx'
import { cmptEchoCrit } from '@/modules/simulation/features/echoes/lib/metric.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'
import { makeEffectiveSetPlan } from '@/engine/gameData/sonataPlan'
import { getSntSetClr, getSntSetIco } from '@/data/gameData/catalog/sonataSets'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { formatCompactNum, formatStatKeyLabel } from '@/modules/simulation/model/statsView.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { glyphVars, resSeqIcon, SEQ_NODES } from '@/shared/lib/gameAssets.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'

export type CssVars = CSSProperties & Record<string, string | number>

export interface EvaluationEchoSelection {
  selectionMode: boolean
  isSelected: (id: string) => boolean
  buildClickCapture: (id: string) => (event: MouseEvent<HTMLElement>) => void
  getId: (slotIndex: number) => string
  getItems: (id: string, echo: EchoInstance) => MenuEntry[]
  getEmptyItems?: (slotIndex: number) => MenuEntry[]
  surfaceProps: {
    ref?: RefCallback<HTMLElement>
    tabIndex?: number
    onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
    'data-selection-focus-scope'?: string
    'data-selection-focus-active'?: string
    'data-selection-mode-active'?: string
  }
}

/* the two writes a slot can take from the bench itself: keep a copy in the bag,
   and lift the echo back out of the loadout. lifting is undone from the slot it
   left, so the surface hands the card the slot it is currently holding open. */
export interface EvaluationEchoActions {
  canSave: (slotIndex: number) => boolean
  onSave: (slotIndex: number) => void
  onLift: (slotIndex: number) => void
  liftedSlot: number | null
  onUndoLift: () => void
}

export const BUILD_LABEL: Record<EvaluationBuildKey, string> = {
  baselineBuild: 'Baseline 0%',
  active: 'Current Build',
  referenceBuild: 'Reference 100%',
  maximumBuild: 'Maximum 200%',
}

export type DetailBuildKey = 'active' | 'referenceBuild' | 'maximumBuild'

export const DETAIL_BUILD_ORDER: DetailBuildKey[] = ['active', 'referenceBuild', 'maximumBuild']

export const DETAIL_BUILD_LABEL: Record<DetailBuildKey, string> = {
  active: 'Current',
  referenceBuild: '100%',
  maximumBuild: '200%',
}

const STAT_KEY_ICON: Record<string, string> = {
  atk: 'atk',
  atkPercent: 'atk',
  atkFlat: 'atk',
  hp: 'hp',
  hpPercent: 'hp',
  hpFlat: 'hp',
  def: 'def',
  defPercent: 'def',
  defFlat: 'def',
  critRate: 'critrate',
  critDmg: 'critdmg',
  energyRegen: 'energyregen',
  healingBonus: 'healing',
  tuneBreakBoost: 'tune-break-boost',
  basicAtk: 'basic',
  heavyAtk: 'heavy',
  resonanceSkill: 'skill',
  resonanceLiberation: 'liberation',
  aero: 'aero',
  glacio: 'glacio',
  spectro: 'spectro',
  fusion: 'fusion',
  electro: 'electro',
  havoc: 'havoc',
}

const ELEMENT_KEYS = new Set(['aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc'])

export function statIconSrc(key: string): string | null {
  const file = STAT_KEY_ICON[key]
  return file ? `/assets/game/stats/icons/${file}.png` : null
}

// stable id for a stat across the card so flat/percent variants of the same stat
// (atk/atkFlat/atkPercent, etc.) read as one family for the hover-focus feature.
// STAT_KEY_ICON is the single mapping for these stat variants.
export function statFamily(key: string): string {
  return STAT_KEY_ICON[key] ?? key
}

export function statTint(key: string): string {
  if (ELEMENT_KEYS.has(key)) {
    return ATTR_COLORS[key as AttributeKey] ?? 'var(--resonator-accent)'
  }
  return 'color-mix(in srgb, var(--muted) 50%, var(--text))'
}

export interface SonataPlanEntry {
  id: number
  count: number
  icon: string | null
}

export function buildSonataPlan(echoes: Parameters<typeof countEchoSets>[0]): SonataPlanEntry[] {
  return makeEffectiveSetPlan(
    Object.entries(countEchoSets(echoes)).map(([setId, count]) => [Number(setId), count] as const),
  ).map((entry) => ({ id: entry.setId, count: entry.pieces, icon: getSntSetIco(entry.setId) }))
}

export type SonataTokenSet = EvaluationSetSummary & { icon?: string | null }

export function SonataTokens({
  sets,
  className,
  emptyLabel,
  emptyToken = false,
}: {
  sets: SonataTokenSet[]
  className: string
  emptyLabel: string
  emptyToken?: boolean
}) {
  if (sets.length === 0) {
    return emptyToken ? (
      <span className={className}>
        <span className="wk-sonata-set wk-sonata-set--empty" title="No sonata sets">
          <span className="wk-sonata-icon wk-sonata-icon--fallback" />
          <span className="wk-sonata-pc">{emptyLabel}</span>
        </span>
      </span>
    ) : <span className={`${className} wk-sonata-empty`}>{emptyLabel}</span>
  }

  return (
    <span className={className}>
      {sets.map((set) => {
        const icon = set.icon ?? getSntSetIco(set.setId)
        return (
          <span key={set.setId} className="wk-sonata-set" title={`${set.name} · ${set.pieces}pc`}>
            {icon ? (
              <DisplayImage src={icon} alt="" className="wk-sonata-icon" loading="lazy" onError={withDefIconM} />
            ) : (
              <span className="wk-sonata-icon wk-sonata-icon--fallback" />
            )}
            <span className="wk-sonata-pc">{set.pieces}</span>
          </span>
        )
      })}
    </span>
  )
}

export function scheduleEvaluationTargetWork(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    callback()
    return () => undefined
  }

  const idleWindow = window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (handle: number) => void
  }

  if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 180 })
    return () => idleWindow.cancelIdleCallback?.(handle)
  }

  const handle = window.setTimeout(callback, 80)
  return () => window.clearTimeout(handle)
}

export const EVALUATION_RAIL_EXIT_MS = 120
export const EVALUATION_RAIL_ENTER_MS = 260
export const EVALUATION_SURFACE_EXIT_MS = 180
export const EVALUATION_SURFACE_ENTER_MS = 460
// must match the rail width transition so dependent measurements wait for stable geometry.
export const EVALUATION_RAIL_RESIZE_MS = 460
export const EVALUATION_RAIL_PRELOAD_TIMEOUT_MS = 260

export function preloadEvaluationRailImages(assets: Array<{ src: string; width: number }>): Promise<void> {
  if (typeof window === 'undefined' || assets.length === 0) {
    return Promise.resolve()
  }

  const uniqueUrls = Array.from(new Set(assets.filter(({ width }) => width > 0)
    .map(({ src, width }) => resolveDisplayImage(src, width, currentPixelRatio()).src)))
  if (!uniqueUrls.length) return Promise.resolve()
  return new Promise((resolve) => {
    let pending = uniqueUrls.length
    let finished = false
    const images: HTMLImageElement[] = []
    const finish = () => {
      if (finished) return
      finished = true
      window.clearTimeout(timeout)
      for (const image of images) {
        image.onload = null
        image.onerror = null
        // a timed-out transition must not keep decoding images that are no
        // longer needed by the incoming rail.
        if (!image.complete) {
          image.removeAttribute('srcset')
          image.removeAttribute('src')
        }
      }
      resolve()
    }
    const timeout = window.setTimeout(finish, EVALUATION_RAIL_PRELOAD_TIMEOUT_MS)
    for (const url of uniqueUrls) {
      const image = new Image()
      images.push(image)
      image.onload = image.onerror = () => {
        pending -= 1
        if (pending === 0) finish()
      }
      image.decoding = 'async'
      image.src = url
    }
  })
}

export function fmtSignedPct(value: number): string {
  if (!Number.isFinite(value)) return '--'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${formatTruncCompact(value, 1)}%`
}

export function fmtSignedNumber(value: number): string {
  if (!Number.isFinite(value)) return '--'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${formatCompactNum(value)}`
}

export function deltaSign(value: number): 'up' | 'down' | 'flat' {
  if (value > 0.0001) return 'up'
  if (value < -0.0001) return 'down'
  return 'flat'
}

export function StatGlyph({ statKey, size }: { statKey: string; size?: number }) {
  const icon = statIconSrc(statKey)
  if (!icon) return null
  return (
    <span className="wk-stat-glyph"
      style={{
        '--stat-color': statTint(statKey),
        ...(size ? { width: `${size}rem`, height: `${size}rem` } : {}),
        WebkitMaskImage: `url("${icon}")`,
        maskImage: `url("${icon}")`,
      } as CssVars}
    />
  )
}

export interface SwapSide {
  label: string
  glyph?: string
  empty?: boolean
  sets?: EvaluationSetSummary[]
}

export interface AlternativePathGroup {
  id: string
  from: SwapSide
  to: SwapSide[]
  hiddenCount: number
  representative: EvaluationAlternative
}

export function describeSwap(
  alt: EvaluationAlternative,
): { from: SwapSide; to: SwapSide } {
  if (alt.kind === 'sonataSet') {
    return {
      from: { label: 'No set', sets: alt.fromSets ?? [] },
      to: { label: 'No set', sets: alt.toSets ?? [] },
    }
  }
  return {
    from: alt.fromPrimary
      ? { label: formatStatKeyLabel(alt.fromPrimary.key), glyph: alt.fromPrimary.key }
      : { label: 'Empty', empty: true },
    to: alt.toPrimary
      ? { label: formatStatKeyLabel(alt.toPrimary.key), glyph: alt.toPrimary.key }
      : { label: 'Empty', empty: true },
  }
}

export function SwapToken({ side }: { side: SwapSide }) {
  if (side.sets) {
    return (
      <span className="wk-swap-token wk-swap-token--sets">
        <SonataTokens sets={side.sets} className="wk-swap-sets" emptyLabel={side.label} />
      </span>
    )
  }
  return (
    <span className="wk-swap-token">
      {side.empty ? (
        <span className="wk-swap-img wk-swap-img--empty" />
      ) : null}
      {side.glyph ? <StatGlyph statKey={side.glyph} size={0.95} /> : null}
      <span className="wk-swap-label">{side.label}</span>
    </span>
  )
}

export function groupAlternatives(alternatives: EvaluationAlternative[]): AlternativePathGroup[] {
  const groups = new Map<string, {
    from: SwapSide
    to: SwapSide[]
    representative: EvaluationAlternative
  }>()

  for (const alternative of alternatives) {
    const swap = describeSwap(alternative)
    const keyParts: Array<string | number> = [
      alternative.operation,
      alternative.cost,
      alternative.fromPrimary?.key ?? 'none',
      alternative.fromSecondaryKey ?? 'none',
      alternative.score,
      alternative.scoreDelta,
      alternative.damage,
      alternative.damageDelta,
      alternative.damageDeltaPct,
    ]
    if (alternative.kind === 'sonataSet') {
      keyParts.push(alternative.from ?? 'none', alternative.to ?? 'none')
    }
    const key = keyParts.join('|')
    const group = groups.get(key)
    if (group) {
      group.to.push(swap.to)
    } else {
      groups.set(key, {
        from: swap.from,
        to: [swap.to],
        representative: alternative,
      })
    }
  }

  return [...groups.entries()].map(([id, group]) => {
    const sortedTo = group.to.slice().sort((left, right) => (
      left.label.localeCompare(right.label)
    ))
    return {
      id,
      from: group.from,
      to: sortedTo.slice(0, 1),
      hiddenCount: Math.max(0, sortedTo.length - 1),
      representative: group.representative,
    }
  })
}

export function EchoCard({
  echo,
  sourceEcho,
  index,
  selection,
  onOpen,
  actions,
  score = null,
  unpainted = false,
}: {
  echo: EvaluationEchoSlot | null
  sourceEcho?: EchoInstance | null
  index: number
  selection?: EvaluationEchoSelection
  score?: number | null
  unpainted?: boolean
  /* the slot is the way into its own editor: an empty one opens the picker, a
     filled one opens the editor. a surface that cannot write leaves it out. */
  onOpen?: () => void
  actions?: EvaluationEchoActions
}) {
  // selection mode handles the click; the slot opens only when selection mode is off
  const openProps = onOpen
    ? {
        role: 'button',
        tabIndex: 0,
        onClick: () => {
          if (selection?.selectionMode) return
          onOpen()
        },
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          if (selection?.selectionMode) return
          event.preventDefault()
          onOpen()
        },
      }
    : null

  const lifted = actions?.liftedSlot === index

  if (!echo) {
    const emptyCard = (
      <article
        className={`wk-echo wk-echo--empty${onOpen ? ' is-openable' : ''}`}
        style={{ '--i': index } as CssVars}
        aria-label={onOpen ? `Slot ${index + 1}, empty. Choose an echo` : undefined}
        {...openProps}
      >
        <span className="wk-echo-empty-mark">{index + 1}</span>
        <span className="wk-echo-empty-label">{lifted ? 'Lifted out' : 'Empty'}</span>
        {lifted && actions ? (
          <>
            <button
              type="button" className="wk-echo-undo"
              onClick={(event) => {
                event.stopPropagation()
                actions.onUndoLift()
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <Undo2 size="0.72rem" aria-hidden="true" />
              Undo
            </button>
            <span className="wk-echo-wear" aria-hidden="true" />
          </>
        ) : null}
      </article>
    )
    return selection?.getEmptyItems ? (
      <ContextTrigger
        asChild
        ariaLabel={`Echo slot ${index + 1} actions`}
        items={selection.getEmptyItems(index)}
      >
        {emptyCard}
      </ContextTrigger>
    ) : emptyCard
  }

  const echoDef = getEchoById(echo.echoId)
  const setIcon = getSntSetIco(echo.setId)
  const setColor = getSntSetClr(echo.setId)
  const itemId = selection?.getId(index) ?? null
  const selected = itemId ? selection?.isSelected(itemId) ?? false : false
  /* selection mode routes these writes through its toolbar; hide the gutter
     actions during selection. */
  const gutter = actions && !selection?.selectionMode
  const canSave = gutter ? actions.canSave(index) : false
  const echoLabel = echoDef?.name ?? echo.echoName
  const tuned = echo.equippedSubstats.length > 0
  const scored = score != null && score > 0
  const cv = cmptEchoCrit(Object.fromEntries(echo.equippedSubstats.map((stat) => [stat.key, stat.value])))
  const card = (
    <article
      className={[
        'wk-echo',
        'ecr-card',
        onOpen ? 'ecr-card--live' : '',
        gutter ? 'has-gutter' : '',
        onOpen ? 'is-openable' : '',
        echo.mainEcho ? 'is-main' : '',
        scored ? 'is-scored' : '',
        unpainted ? 'is-unpainted' : '',
        selection?.selectionMode ? 'selection-mode' : '',
        selected ? 'focus-selected' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--i': index, ...echoCardVars({ setColor, cv, score }) } as CssVars}
      data-selection-focus-item={sourceEcho ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      onClickCapture={itemId && sourceEcho ? selection?.buildClickCapture(itemId) : undefined}
      aria-label={onOpen ? `Edit ${echoLabel}` : undefined}
      {...openProps}
    >
      {gutter && actions ? (
        <div className="wk-echo-gut" onKeyDown={(event) => event.stopPropagation()}>
          <button
            type="button" className="wk-echo-ctl"
            title={canSave ? 'Save to bag' : 'Already in the bag'}
            aria-label={canSave ? `Save ${echoLabel} to bag` : `${echoLabel} is already in the bag`}
            data-saved={canSave ? undefined : 'true'}
            disabled={!canSave}
            onClick={(event) => {
              event.stopPropagation()
              actions.onSave(index)
            }}
          >
            <LibraryBig size="0.86rem" aria-hidden="true" />
          </button>
          <button
            type="button" className="wk-echo-ctl wk-echo-ctl--lift"
            title={`Lift out of slot ${index + 1}`}
            aria-label={`Lift ${echoLabel} out of slot ${index + 1}`}
            onClick={(event) => {
              event.stopPropagation()
              actions.onLift(index)
            }}
          >
            <ArrowUpFromLine size="0.86rem" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <EchoCardBand
        icon={echoDef?.icon}
        name={echoLabel}
        setIcon={setIcon}
        setName={echo.setName}
        mainEcho={echo.mainEcho}
        primary={echo.primary}
        secondary={echo.secondary}
      />

      {/* the bench names what it is editing, which the modals leave to the art */}
      <div className="wk-echo-title">
        <span className="wk-echo-name">{echoLabel}</span>
        <span className="wk-echo-cost">{echo.cost}C</span>
      </div>

      {tuned ? (
        <>
          <EchoCardList subs={echo.equippedSubstats} />
          <EchoCardRibbon cv={cv} score={score} />
        </>
      ) : (
        <p className="wk-echo-subs-empty">No tuned substats</p>
      )}
    </article>
  )

  if (!selection || !sourceEcho || !itemId) {
    return card
  }

  return (
    <ContextTrigger
      asChild
      ariaLabel={`${echoDef?.name ?? echo.echoName} actions`}
      items={selection.getItems(itemId, sourceEcho)}
    >
      {card}
    </ContextTrigger>
  )
}

export function EvaluationSeqRail({
  resId,
  sequence,
  hidden,
  onActivate,
}: {
  resId: string
  sequence: number
  hidden: boolean
  onActivate?: (node: number) => void
}) {
  const fill = sequence > 1 ? ((sequence - 1) / 5) * 100 : 0
  // the rail only takes clicks where it is actually read: a hidden rail is
  // decoration for the screenshot and stays out of the tab order.
  const live = Boolean(onActivate) && !hidden
  return (
    <div className="wk-seq-rail"
      data-hidden={hidden ? 'true' : undefined}
      style={{ '--seq-fill': `${fill}%` } as CssVars}
      aria-hidden={hidden ? 'true' : undefined}
      aria-label={hidden ? undefined : `Resonance chain ${sequence} of 6`}
    >
      {Array.from({ length: SEQ_NODES }, (_, i) => {
        const node = i + 1
        const glyph = (
          <span className="wk-seq-glyph"
            style={glyphVars(resSeqIcon(resId, node), '--seq-mask') as CssVars}
          />
        )
        const nodeProps = {
          className: 'wk-seq-node',
          'data-on': node <= sequence ? 'true' : undefined,
          'data-current': node === sequence && sequence > 0 ? 'true' : undefined,
        }
        return live ? (
          <button
            key={node}
            type="button"
            {...nodeProps}
            aria-pressed={node <= sequence}
            aria-label={`Sequence ${node}`}
            onClick={() => onActivate?.(node)}
          >
            {glyph}
          </button>
        ) : (
          <span key={node} {...nodeProps}>
            {glyph}
          </span>
        )
      })}
    </div>
  )
}

export function ResonatorName({ name, onOpen }: { name: string; onOpen?: () => void }) {
  if (!onOpen) return <>{name}</>
  return (
    <button type="button" className="wk-name-link" onClick={onOpen} aria-label={`Configure ${name}`}>
      {name}
    </button>
  )
}
