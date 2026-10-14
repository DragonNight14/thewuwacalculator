/*
  Author: Runor Ewhro
  description: derives weapon, set-tier, and main-stat differences between a
               held suggestion and the equipped loadout.
*/

import { useMemo, useState } from 'react'
import type { CSSProperties as CssProps } from 'react'
import type { EchoInstance, WeaponState } from '@/domain/entities/runtime.ts'
import { DisplayImage } from '@/shared/ui/DisplayImage'
import { glyphVars } from '@/shared/lib/gameAssets.ts'
import { withDefIconM, withDefWpnMg } from '@/shared/lib/imageFallback.ts'
import { getEchoById } from '@/data/catalog/echoCatalogService.ts'
import { getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { cmptSetCnts } from '@/modules/simulation/features/echoes/lib/echoPane.ts'
import {
  fmtWpnStatDs,
  getWeapon,
  resPssvPrms,
  weaponStatsAt,
  WPN_STAT_CNS,
  WPNSTATLBLS,
} from '@/modules/simulation/features/weapons/lib/weapon.ts'
import { getRarityColor, getWpnTypeLb, WPNTYPETOKEY } from '@/modules/simulation/model/display.ts'
import { formatCompactNum, formatStatKeyLabel, formatStatKeyValue } from '@/modules/simulation/model/statsView.ts'
import { RichDscr } from '@/modules/simulation/ui/RichDescription.tsx'
import { statIconSrc } from '@/modules/simulation/workspace/ui.tsx'
import { readSetTiers } from '@/modules/simulation/workspace/LoadoutEffects.tsx'
import { getDiffLabel, getDiffTone } from '../lib/suggestions.ts'
import type { Kind, Row } from '@/modules/simulation/surfaces/suggestions/results/model.ts'

const pct = (value: number) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${getDiffLabel(value, false)}`

const tone = (value: number) => {
  const result = getDiffTone(value)
  return result === 'positive' ? 'up' : result === 'negative' ? 'dn' : 'zero'
}

function Glyph({ src }: { src: string | null }) {
  return src ? <i className="suggestion-results-comparison-glyph" aria-hidden="true" style={glyphVars(src, '--g')} /> : null
}

interface WeaponFace {
  name: string
  icon: string
  rarity: number
  rank: number
  atk: number
  statKey: string
  statValue: number
}

function WeaponHead({ face }: { face: WeaponFace }) {
  return (
    <div className="suggestion-results-comparison-wpn">
      <span className="wcon-icon">
        <DisplayImage src={face.icon} alt="" decoding="async" onError={withDefWpnMg} />
        <i className="wcon-rank">R{face.rank}</i>
      </span>
      <span className="wcon-plate">
        <span className="wcon-name" title={face.name}>{face.name}</span>
        <WeaponStats face={face} />
      </span>
    </div>
  )
}

function WeaponStats({ face, extra }: { face: WeaponFace, extra?: string }) {
  return (
    <span className="wcon-statline">
      <span className="wcon-stat" title="Base ATK">
        <span className="wcon-stat-glyph" aria-hidden="true" style={glyphVars(WPN_STAT_CNS.atk, '--g')} />
        {Math.floor(face.atk)}
      </span>
      <span className="wcon-stat" title={WPNSTATLBLS[face.statKey] ?? face.statKey}>
        {WPN_STAT_CNS[face.statKey] ? (
          <span className="wcon-stat-glyph" aria-hidden="true" style={glyphVars(WPN_STAT_CNS[face.statKey], '--g')} />
        ) : null}
        {fmtWpnStatDs(face.statKey, face.statValue)}
      </span>
      {extra ? <span className="wcon-stat suggestion-results-comparison-faint">{extra}</span> : null}
    </span>
  )
}

function Weapon({ row, equipped }: { row: Row, equipped: WeaponState }) {
  const [fold, setFold] = useState(false)
  const plan = row.weapon!
  const catalog = getWeapon(plan.weaponId)
  const rarity = getRarityColor(plan.rarity) ?? 'var(--muted)'
  const typeKey = catalog ? WPNTYPETOKEY[catalog.weaponType] : null
  const held: WeaponFace = {
    name: plan.name, icon: plan.icon, rarity: plan.rarity, rank: plan.rank,
    atk: plan.baseAtk, statKey: plan.statKey, statValue: plan.statValue,
  }

  const worn = row.equipped ? null : getWeapon(equipped.id)
  const wornStats = worn ? weaponStatsAt(worn, equipped.level) : null
  const wornFace: WeaponFace | null = worn && wornStats ? {
    name: worn.name, icon: worn.icon, rarity: worn.rarity, rank: equipped.rank,
    atk: wornStats.atk, statKey: worn.statKey, statValue: wornStats.scndStatVl,
  } : null

  // preserve both scored passive modes when the result provides them.
  const stacked = row.variants.find((variant) => variant.mode === 'max') ?? null
  const resting = row.variants.find((variant) => variant.mode === 'default') ?? null

  return (
    <>
      <div className="wcon-body suggestion-results-comparison-body" style={{ '--rar': rarity } as CssProps}>
        <span className="wcon-sec">
          {typeKey ? (
            <i className="wcon-sec-type" aria-hidden="true" style={glyphVars(`/assets/game/weapons/types/${typeKey}.webp`, '--g')} />
          ) : null}
          {catalog ? getWpnTypeLb(catalog.weaponType) : 'Weapon'}
          <i className="wcon-sec-sep" aria-hidden="true" />
          <span className="wcon-sec-passive">{catalog?.passive.name || plan.pssvName}</span>
        </span>
        <WeaponHead face={held} />
        <i className="wcon-rule" aria-hidden="true" />
        {catalog?.passive.desc ? (
          <RichDscr
            className="wcon-passive"
            description={catalog.passive.desc}
            params={resPssvPrms(catalog.passive.params, plan.rank)}
            accentColor={rarity}
          />
        ) : null}
        {stacked && resting ? (
          <span className="suggestion-results-comparison-dmg">
            <span>Stacked <b>{formatCompactNum(stacked.damage)}</b> <em className={tone(stacked.delta)}>{pct(stacked.delta)}</em></span>
            <span>Resting <b>{formatCompactNum(resting.damage)}</b> <em className={tone(resting.delta)}>{pct(resting.delta)}</em></span>
          </span>
        ) : null}
      </div>

      {worn && wornFace ? (
        <section className="lho-fx-part">
          <h4 className="lho-fx-head">Equipped</h4>
          <button
            type="button"
            className="suggestion-results-comparison-fold"
            aria-expanded={fold}
            onClick={() => setFold((open) => !open)}
          >
            <DisplayImage src={worn.icon} alt="" decoding="async" onError={withDefWpnMg} />
            <span className="suggestion-results-comparison-fold-name">
              <strong>{worn.name}</strong>
              <WeaponStats face={wornFace} extra={worn.passive.name} />
            </span>
            <i className="suggestion-results-comparison-chev" aria-hidden="true" />
          </button>
          <div className={`suggestion-results-comparison-fold-body${fold ? ' is-open' : ''}`}>
            <div>
              {worn.passive.desc ? (
                <RichDscr
                  className="wcon-passive"
                  description={worn.passive.desc}
                  params={resPssvPrms(worn.passive.params, equipped.rank)}
                  accentColor={getRarityColor(worn.rarity) ?? 'var(--muted)'}
                />
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </>
  )
}

interface SetMove {
  id: number
  name: string
  icon: string | null
  from: number
  to: number
}

function Pips({ from, to }: { from: number, to: number }) {
  return (
    <span className="suggestion-results-comparison-pips" role="img" aria-label={`${from} to ${to} pieces`}>
      {Array.from({ length: 5 }, (_, index) => {
        const state = index < Math.min(from, to) ? 'is-kept' : index < to ? 'is-gain' : index < from ? 'is-lost' : ''
        return <i key={index} className={`suggestion-results-comparison-pip ${state}`} />
      })}
    </span>
  )
}

const GROUPS = [
  { key: 'gain', label: 'Gained' },
  { key: 'kept', label: 'Kept' },
  { key: 'lost', label: 'Lost' },
] as const

function Sets({ row, echoes, next }: {
  row: Row
  echoes: Array<EchoInstance | null>
  next: Array<EchoInstance | null>
}) {
  const { moves, effects, swaps } = useMemo(() => {
    const before = cmptSetCnts(echoes)
    const after = cmptSetCnts(next)
    const ids = [...new Set([...Object.keys(before), ...Object.keys(after)].map(Number))]
    const all: SetMove[] = ids.flatMap((id) => {
      const set = readSetTiers(id)
      return set ? [{ id, name: set.name, icon: set.icon, from: before[id] ?? 0, to: after[id] ?? 0 }] : []
    }).sort((a, b) => Math.max(b.from, b.to) - Math.max(a.from, a.to))

    const effects: Record<(typeof GROUPS)[number]['key'], Array<{ move: SetMove, pieces: number, desc: string }>> = {
      gain: [], kept: [], lost: [],
    }
    for (const move of all) {
      for (const tier of readSetTiers(move.id)?.tiers ?? []) {
        const was = move.from >= tier.pieces
        const is = move.to >= tier.pieces
        const group = is && !was ? 'gain' : is && was ? 'kept' : was ? 'lost' : null
        if (group) effects[group].push({ move, pieces: tier.pieces, desc: tier.desc })
      }
    }

    // a tray offers effect-equivalent sets; name the ones the plan does not use.
    const used = new Set((row.setPlan ?? []).map((entry) => getSntSetNam(entry.setId)))
    const seen = new Set<string>()
    const swaps = row.trays.flatMap((tray) => {
      const others = tray.names
        .map((name, index) => ({ name, icon: tray.coins[index] ?? null }))
        .filter((entry) => !used.has(entry.name))
      const key = `${tray.lead}:${others.map((entry) => entry.name).join('|')}`
      if (!others.length || seen.has(key)) return []
      seen.add(key)
      return [{ key, pieces: tray.lead, others }]
    })

    return { moves: all.filter((move) => move.from !== move.to || row.now), effects, swaps }
  }, [echoes, next, row.now, row.setPlan, row.trays])

  return (
    <>
      <section className="lho-fx-part">
        <h4 className="lho-fx-head">Set pieces</h4>
        <div className="suggestion-results-comparison-pieces">
          {moves.map((move) => (
            <div key={move.id} className="suggestion-results-comparison-piece">
              <span className="suggestion-results-comparison-piece-name">
                {move.icon ? <DisplayImage src={move.icon} alt="" decoding="async" onError={withDefIconM} /> : null}
                {move.name}
              </span>
              <Pips from={move.from} to={move.to} />
              <span className="suggestion-results-comparison-piece-n">{move.from} → {move.to}</span>
            </div>
          ))}
        </div>
        {swaps.map((swap) => (
          <p key={swap.key} className="suggestion-results-comparison-alt">
            {swap.others.map((entry, index) => (
              <span key={entry.name}>
                {index > 0 ? (index === swap.others.length - 1 ? ' or ' : ', ') : null}
                {entry.icon ? <DisplayImage src={entry.icon} alt="" decoding="async" onError={withDefIconM} /> : null}
                {entry.name}
              </span>
            ))}{' '}
            {swap.others.length > 1 ? 'give' : 'gives'} the same {swap.pieces}pc effect.
          </p>
        ))}
      </section>

      <section className="lho-fx-part">
        <h4 className="lho-fx-head">Sonata effect</h4>
        {GROUPS.map((group) => effects[group.key].length ? (
          <div key={group.key} className={`suggestion-results-comparison-grp is-${group.key}`}>
            <span className="suggestion-results-comparison-grp-k">{group.label}</span>
            {effects[group.key].map(({ move, pieces, desc }) => (
              <div key={`${move.id}:${pieces}`} className="lho-fx-tier" data-on={group.key === 'lost' ? undefined : 'true'}>
                <span className="lho-fx-mark" role="img" aria-label={group.key === 'lost' ? 'Not active' : 'Active'} />
                <div className="lho-fx-tier-body">
                  <span className="lho-fx-tier-head">
                    {move.icon ? <DisplayImage src={move.icon} alt="" className="lho-fx-glyph" decoding="async" onError={withDefIconM} /> : null}
                    {move.name}
                    <span className="suggestion-results-comparison-pc">{pieces}pc</span>
                  </span>
                  <RichDscr description={desc} className="rich-description lho-fx-desc" />
                </div>
              </div>
            ))}
          </div>
        ) : null)}
        {GROUPS.every((group) => !effects[group.key].length) ? (
          <p className="lho-fx-empty">No set reaches its first tier.</p>
        ) : null}
      </section>
    </>
  )
}

function MainStats({ echoes, next }: { echoes: Array<EchoInstance | null>, next: Array<EchoInstance | null> }) {
  const { slots, totals } = useMemo(() => {
    // a recipe has no slot identity: pair identical main stats within each
    // cost first, and only what is left over counts as a change.
    type Main = { key: string, value: number }
    const byCost = (list: Array<EchoInstance | null>) => {
      const groups = new Map<number, Main[]>()
      for (const echo of list) {
        const cost = echo ? getEchoById(echo.id)?.cost : null
        if (!echo || !cost) continue
        groups.set(cost, [...(groups.get(cost) ?? []), echo.mainStats.primary])
      }
      return groups
    }
    const before = byCost(echoes)
    const after = byCost(next)
    const slots: Array<{ index: string, cost: number, from: Main, to: Main, same: boolean }> = []
    for (const cost of [...before.keys()].sort((a, b) => b - a)) {
      const left = [...(before.get(cost) ?? [])]
      const right = [...(after.get(cost) ?? [])]
      const changed: Main[] = []
      for (const stat of left) {
        const at = right.findIndex((entry) => entry.key === stat.key && entry.value === stat.value)
        if (at < 0) { changed.push(stat); continue }
        right.splice(at, 1)
        slots.push({ index: `${cost}:${slots.length}`, cost, from: stat, to: stat, same: true })
      }
      changed.forEach((stat, at) => {
        const to = right[at] ?? stat
        slots.push({ index: `${cost}:${slots.length}`, cost, from: stat, to, same: false })
      })
    }
    slots.sort((a, b) => b.cost - a.cost || Number(a.same) - Number(b.same))
    const sum = new Map<string, number>()
    for (const slot of slots) {
      sum.set(slot.from.key, (sum.get(slot.from.key) ?? 0) - slot.from.value)
      sum.set(slot.to.key, (sum.get(slot.to.key) ?? 0) + slot.to.value)
    }
    const totals = [...sum].filter(([, value]) => Math.abs(value) > 1e-6)
    return { slots, totals }
  }, [echoes, next])

  return (
    <>
      <section className="lho-fx-part">
        <h4 className="lho-fx-head">Main stats</h4>
        <div className="suggestion-results-comparison-stats">
          {slots.map((slot) => (
            <div key={slot.index} className={`suggestion-results-comparison-stat${slot.same ? ' is-same' : ' is-new'}`}>
              <span className="suggestion-results-comparison-cost">{slot.cost}c</span>
              <span className="suggestion-results-comparison-stat-name">
                <Glyph src={statIconSrc(slot.to.key)} />
                {formatStatKeyLabel(slot.to.key)}
              </span>
              <span className="suggestion-results-comparison-fig">
                {slot.same ? null : (
                  <s>{formatStatKeyLabel(slot.from.key)} {formatStatKeyValue(slot.from.key, slot.from.value)}</s>
                )}
                <span className="suggestion-results-comparison-to">{formatStatKeyValue(slot.to.key, slot.to.value)}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="lho-fx-part">
        <h4 className="lho-fx-head">Stat change</h4>
        {totals.length ? (
          <div className="suggestion-results-comparison-stats">
            {totals.map(([key, value]) => (
              <div key={key} className="suggestion-results-comparison-stat">
                <span><Glyph src={statIconSrc(key)} /></span>
                <span className="suggestion-results-comparison-stat-name">{formatStatKeyLabel(key)}</span>
                <span className={`suggestion-results-comparison-fig ${value > 0 ? 'up' : 'dn'}`}>
                  {value > 0 ? '+' : '−'}{formatStatKeyValue(key, Math.abs(value))}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="lho-fx-empty">Same main stats as equipped.</p>
        )}
      </section>
    </>
  )
}

export function Comparison({ kind, row, weapon, echoes, preview }: {
  kind: Kind
  row: Row
  weapon: WeaponState
  echoes: Array<EchoInstance | null>
  /** materialized candidate loadout; null identifies the worn baseline. */
  preview: Array<EchoInstance | null> | null
}) {
  if (row.weapon) return <Weapon row={row} equipped={weapon} />
  const next = preview ?? echoes
  if (kind === 'setPlans') return <Sets row={row} echoes={echoes} next={next} />
  return <MainStats echoes={echoes} next={next} />
}
