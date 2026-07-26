/*
  Author: Runor Ewhro
  Description: Renders the row surface for the calculator optimizer flow.
*/

import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import { SonataTokens } from '@/modules/calculator/features/benchmark/ui.tsx'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects.ts'

export interface OptDsplStts {
  atk: number
  hp: number
  def: number
  er: number
  cr: number
  cd: number
  bonus: number
  amp: number
}

export interface OptDsplSetEn {
  id: number
  icon: string | null
  count: number
}

export interface OptDisplayRow {
  damage: number
  stats: OptDsplStts | null
  // the per-echo cost combo is stored because every legal loadout already sums
  // to 12, making the total less useful than the chosen cost distribution.
  costs: number[] | null
  sets: OptDsplSetEn[]
  mainEchoIcon: string | null
  // best weapon for this build when weapon search is active (theory mode), else
  // null. surfaced as its own column, mirroring the main echo.
  weaponIcon: string | null
  weaponName: string | null
}

interface OptRowPrps {
  result: OptDisplayRow
  baseDamage?: number
  base?: boolean
  rotationMode?: boolean
  // render the weapon column (theory weapon search active)
  showWeapon?: boolean
  selected?: boolean
  onClick?: () => void
}

function renderStat(value: number | null | undefined, formatter: (next: number) => string): string {
  if (value == null || !Number.isFinite(value)) {
    return '...'
  }

  return formatter(value)
}

function displayedDamage(value: number): number {
  return Math.floor(value || 0)
}

function formatEfficiency(damage: number, baseDamage: number | undefined, base: boolean): string {
  if (base || !baseDamage || baseDamage <= 0) {
    return '100.00'
  }

  const baseDisplayDamage = displayedDamage(baseDamage)
  if (baseDisplayDamage > 0 && displayedDamage(damage) === baseDisplayDamage) {
    return '100.00'
  }

  return formatTruncCompact((damage / baseDamage) * 100, 2)
}

export function Row({
  result,
  baseDamage,
  base = false,
  rotationMode = false,
  showWeapon = false,
  selected = false,
  onClick,
}: OptRowPrps) {
  const { stats, costs, sets, mainEchoIcon, weaponIcon, weaponName, damage } = result
  const displayDamage = displayedDamage(damage)
  const diff = formatEfficiency(damage, baseDamage, base)

  function viewSetBdgs() {
    if (!sets || sets.length === 0) return <span className="empty-set">…</span>

    // same sonata-token rendering as the benchmark set plan so the results
    // table and the set-plan picker read identically.
    return (
      <SonataTokens
        sets={sets.map((entry) => ({
          setId: entry.id,
          name: getEchoSetDe(entry.id)?.name ?? `Set ${entry.id}`,
          pieces: entry.count,
          icon: entry.icon,
        }))}
        className="bench-srel-set-plan opt-row-plan"
        emptyLabel="…"
      />
    )
  }

  function viewCostCombo() {
    if (!costs || costs.length === 0) return <span className="cost-combo cost-combo--empty">…</span>
    const total = costs.reduce((sum, value) => sum + value, 0)
    return (
      <span className="cost-combo" title={`Total cost: ${total}`}>
        {costs.map((value, index) => (
          <span key={`${index}-${value}`} className="cost-combo__group">
            {index > 0 ? (
              <span className="cost-combo__sep" aria-hidden="true">⟡</span>
            ) : null}
            <span className={`cost-combo__digit cost-combo__digit--c${value}`}>
              {value}
            </span>
          </span>
        ))}
      </span>
    )
  }

  return (
    <div
      className={`opt-result-row${selected ? ' is-selected' : ''}${base ? ' is-base' : ''}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick) {
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="opt-result-row__col opt-result-row__col--sets">{viewSetBdgs()}</div>
      <div className="opt-result-row__col opt-result-row__col--echo">
        {mainEchoIcon ? (
          <img src={mainEchoIcon} alt="main echo" className="opt-result-row__echo-icon" loading="lazy" onError={withDefEchoMg} />
        ) : (
          <span className="opt-result-row__placeholder">...</span>
        )}
      </div>
      {showWeapon ? (
        <div className="opt-result-row__col opt-result-row__col--weapon">
          {weaponIcon ? (
            <img
              src={weaponIcon}
              alt={weaponName ?? 'weapon'}
              title={weaponName ?? undefined}
              className="opt-result-row__weapon-icon"
              loading="lazy"
              onError={withDefIconM}
            />
          ) : (
            <span className="opt-result-row__placeholder">-</span>
          )}
        </div>
      ) : null}
      <div className="opt-result-row__col opt-result-row__col--cost">{viewCostCombo()}</div>
      <div className="opt-result-row__col">{renderStat(stats?.atk, (value) => Math.floor(value).toString())}</div>
      <div className="opt-result-row__col">{renderStat(stats?.hp, (value) => Math.floor(value).toString())}</div>
      <div className="opt-result-row__col">{renderStat(stats?.def, (value) => Math.floor(value).toString())}</div>
      <div className="opt-result-row__col">{renderStat(stats?.er, (value) => formatTruncCompact(value, 1))}</div>
      <div className="opt-result-row__col">{renderStat(stats?.cr, (value) => formatTruncCompact(value, 1))}</div>
      <div className="opt-result-row__col">{renderStat(stats?.cd, (value) => formatTruncCompact(value, 1))}</div>
      {!rotationMode ? (
        <div className="opt-result-row__col">{renderStat(stats?.bonus, (value) => formatTruncCompact(value, 1))}</div>
      ) : null}
      {!rotationMode ? (
        <div className="opt-result-row__col">{renderStat(stats?.amp, (value) => formatTruncCompact(value, 1))}</div>
      ) : null}
      <div className="opt-result-row__col opt-result-row__col--dmg avg">{displayDamage}</div>
      <div className="opt-result-row__col opt-result-row__col--eff">{diff}%</div>
    </div>
  )
}
