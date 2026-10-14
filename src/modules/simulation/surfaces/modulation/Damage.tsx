/*
  Author: Runor Ewhro
  description: groups the selected member's skill and hit damage and coordinates formula inspection.
*/

import { observeSelectionPip } from '@/shared/lib/observeSelectionPip'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger'
import { BadgePercent, ListChevronsDownUp, ListChevronsUpDown } from 'lucide-react'
import { DisplayImage } from '@/shared/ui/DisplayImage'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { FeatureResult } from '@/domain/gameData/contracts'
import type { DmgBreakdown } from '@/modules/simulation/features/results/lib/damageFormula.ts'
import type { SimResult } from '@/engine/pipeline/types'
import { Expandable } from '@/shared/ui/Expandable'
import { useAppStore } from '@/application/state'
import { selEnemyProf } from '@/application/state'
import { ATTR_COLORS } from '@/modules/simulation/model/display.ts'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { formatCompactNum } from '@/modules/simulation/model/statsView.ts'
import { glyphVars, resNodeIcon, type ResNodeKey } from '@/shared/lib/gameAssets.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { getTabTitle, grpSkllByTab, shldViewSubH } from '@/modules/simulation/features/results/lib/utils.ts'
import { formBrkd } from '@/modules/simulation/features/results/lib/damageFormula.ts'
import { skillDisplayColor, supportSkillStyle } from '@/modules/simulation/surfaces/rotation/shared/skillDisplay.ts'

type CssVars = CSSProperties & Record<string, string | number>

/* every tab but the echoes is one of the resonator's own skill nodes */
const TAB_NODES = new Set<string>([
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
  'outroSkill',
  'tuneBreak',
])

const ECHO_GLYPH = '/assets/game/stats/icons/echo.png'

function tabGlyph(resonatorId: string, tab: string): string {
  return TAB_NODES.has(tab) ? resNodeIcon(resonatorId, tab as ResNodeKey) : ECHO_GLYPH
}

/*
  the column is titled damage and its three number columns are named, so the
  trailing "DMG" present in every feature label is said four times over. it is
  dropped for display only: the formula still titles itself with the real label.
*/
function trimLabel(label: string): string {
  return label.replace(/\s+DMG$/, '')
}

interface RowProps {
  entry: FeatureResult
  at: boolean
  open: boolean
  onPick: (id: string) => void
  onOpen: (id: string) => void
}

function DamageRow({ entry, at, open, onPick, onOpen }: RowProps) {
  const support = supportSkillStyle(entry.aggregationType)
  const hasSubHits = shldViewSubH(entry.subHits)
  const rowStyle = { '--el': skillDisplayColor(entry.skill) } as CssVars
  /* count landings in the pill; one sub-hit can represent a flurry of thirty. */
  const landings = entry.subHits.reduce((total, hit) => total + Math.max(1, hit.count), 0)

  return (
    <>
      <ContextTrigger
        asChild
        ariaLabel={`${entry.skill.label} damage actions`}
        items={[
          {
            id: `modulation:formula:${entry.id}`,
            label: 'See formula',
            icon: <BadgePercent size="1em" />,
            onSelect: () => onPick(entry.id),
          },
          ...(hasSubHits ? [{
            id: `modulation:subhits:${entry.id}`,
            label: open ? 'Hide subhits' : 'Show subhits',
            icon: open ? <ListChevronsDownUp size="1em" /> : <ListChevronsUpDown size="1em" />,
            onSelect: () => onOpen(entry.id),
          }] : []),
        ]}
      >
      <div
        className={at ? 'pgd-row is-at' : 'pgd-row'}
        data-row={entry.id}
        data-open={open ? 'true' : 'false'}
        style={rowStyle}
      >
        <button
          type="button" className="pgd-pick"
          aria-pressed={at}
          aria-label={`Read the formula for ${entry.skill.label}`}
          onClick={() => onPick(entry.id)}
        >
          <s />
        </button>

        <button
          type="button" className="pgd-face"
          aria-expanded={hasSubHits ? open : undefined}
          onClick={() => (hasSubHits ? onOpen(entry.id) : onPick(entry.id))}
        >
          <span className="pgd-nm">
            <span title={entry.skill.label}>{trimLabel(entry.skill.label)}</span>
            {hasSubHits ? (
              <i className="pgd-hits">
                {landings} hit{landings > 1 ? 's' : ''}
              </i>
            ) : null}
          </span>

          {support ? (
            <>
              <span className="pgd-v is-none">-</span>
              <span className="pgd-v is-none">-</span>
            </>
          ) : (
            <>
              <span className="pgd-v">{formatCompactNum(entry.normal)}</span>
              <span className="pgd-v">{formatCompactNum(entry.crit)}</span>
            </>
          )}
          <span className="pgd-v is-avg">{formatCompactNum(entry.avg)}</span>
          <span className={hasSubHits ? 'pgd-car' : 'pgd-car is-off'} aria-hidden="true" />
        </button>
      </div>
      </ContextTrigger>

      {/* the disclosure measures the drawer's expanded height. */}
      <Expandable
        as="div" className="pgd-sub"
        contentOnly
        open={open}
        innerClass="pgd-sub-pad"
        style={rowStyle}
      >
        {entry.subHits.map((hit, index) => (
          <div className="pgd-sub-row" key={`${entry.id}:${index}`} style={{ '--j': index } as CssVars}>
            <span className="pgd-sub-lb">
              {hit.label ? hit.label : `Hit ${index + 1}`}
              {hit.count > 1 ? ` × ${hit.count}` : ''}
            </span>
            <span className="pgd-sub-v">{formatCompactNum(hit.normal)}</span>
            <span className="pgd-sub-v">{formatCompactNum(hit.crit)}</span>
            <span className="pgd-sub-v">{formatCompactNum(hit.avg)}</span>
            <span />
          </div>
        ))}
      </Expandable>
    </>
  )
}

/*
  render each factor, operator, and value in separate worksheet columns with
  the total below. split bars show the contributions within summed factors.
*/
function Worksheet({ breakdown }: { breakdown: DmgBreakdown }) {
  const { chain, after } = breakdown
  if (!chain || chain.length === 0) return null

  return (
    <div className="pgd-ws">
      <p className="pgd-ws-band">Product</p>

      {chain.map((factor) => {
        const weights = factor.terms?.map((term) => Math.abs(Number.parseFloat(term.value)) || 0) ?? []
        const spread = weights.some((weight) => weight > 0)
        return (
          <div className="pgd-ws-r" key={factor.key} data-kind={factor.kind}>
            <span className="pgd-ws-op" aria-hidden="true">{factor.op === 'x' ? '\u00d7' : factor.op}</span>
            <span className="pgd-ws-lb">{factor.label}</span>
            <span className="pgd-ws-vl">{factor.value}</span>

            {factor.terms && factor.terms.length > 0 ? (
              <>
                {factor.terms.length > 1 ? (
                  <span className="pgd-ws-share" aria-hidden="true">
                    {factor.terms.map((term, index) => (
                      <i key={term.label} style={{ flex: spread ? weights[index] || 0.001 : 1 } as CssVars} />
                    ))}
                  </span>
                ) : null}
                <span className="pgd-ws-terms">
                  {factor.terms.map((term) => (
                    <span key={term.label}><b>{term.label}</b> {term.value}</span>
                  ))}
                </span>
              </>
            ) : null}

            {factor.expr ? <span className="pgd-ws-expr">{factor.expr}</span> : null}
          </div>
        )
      })}

      <div className="pgd-ws-rule" aria-hidden="true" />
      <div className="pgd-ws-r pgd-ws-total">
        <span className="pgd-ws-op" aria-hidden="true">=</span>
        <span className="pgd-ws-lb">{breakdown.outLabel}</span>
        <span className="pgd-ws-vl">{breakdown.outValue}</span>
      </div>

      {after && after.length > 0 ? (
        <>
          <p className="pgd-ws-band">Then</p>
          {after.map((step) => (
            <div className="pgd-ws-r" key={step.key}>
              <span className="pgd-ws-op" aria-hidden="true">{'\u2192'}</span>
              <span className="pgd-ws-lb">{step.label}</span>
              <span className="pgd-ws-vl">{step.value}</span>
              <span className="pgd-ws-expr">{step.expr}</span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}

/* render the formula panel beside the list. */
function FormulaCard({
  entry,
  simulation,
  runtime,
  enemy,
}: {
  entry: FeatureResult
  simulation: SimResult
  runtime: ResRuntime
  enemy: EnemyProfile
}) {
  const breakdown = useMemo(
    () => formBrkd(entry, simulation.finalStats, enemy, runtime.base.level, runtime.state.combat),
    [enemy, entry, runtime.base.level, runtime.state.combat, simulation.finalStats],
  )
  const support = supportSkillStyle(entry.aggregationType)
  const element = entry.skill.element
  const icon = getAttributeIconSrc(element)

  return (
    <aside className="pgd-aside rte-scope"
      style={{ '--el': skillDisplayColor(entry.skill) } as CssVars}
    >
      <div className="pgd-card">
        <header className="pgd-card-head">
          <span className="pgd-card-eyebrow">
            {icon ? <DisplayImage src={icon} alt="" loading="lazy" onError={withDefIconM} /> : null}
            {support ? support.label : element}
          </span>
          <b className="pgd-card-name">{trimLabel(entry.skill.label)}</b>
          <span className="pgd-card-grp">{getTabTitle(entry.skill)}</span>
        </header>

        <div className="pgd-trip">
          {support ? (
            <div>
              <span>{support.label.toUpperCase()}</span>
              <b>{formatCompactNum(entry.avg)}</b>
            </div>
          ) : (
            <>
              <div>
                <span>NORMAL</span>
                <b>{formatCompactNum(entry.normal)}</b>
              </div>
              <div>
                <span>CRIT</span>
                <b>{formatCompactNum(entry.crit)}</b>
              </div>
              <div className="is-hot">
                <span>AVG</span>
                <b>{formatCompactNum(entry.avg)}</b>
              </div>
            </>
          )}
        </div>

        <Worksheet breakdown={breakdown} />
      </div>
    </aside>
  )
}

export function ModulationDamage({
  runtime,
  simulation,
}: {
  runtime: ResRuntime
  simulation: SimResult | null
}) {
  const enemy = useAppStore(selEnemyProf)
  const [picked, setPicked] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  /* a skill put away by its own well. the pick is not disturbed by it: what the
     formula is reading stays read even while its rows are held. */
  const [shut, setShut] = useState<Record<string, boolean>>({})

  const groups = useMemo(
    () => (simulation ? grpSkllByTab(simulation.allSkills) : []),
    [simulation],
  )

  /* the first entry reads by default, so the formula is never empty */
  const first = groups[0]?.[1][0]?.id ?? null
  const at = picked && simulation?.allSkills.some((entry) => entry.id === picked) ? picked : first
  const atEntry = simulation?.allSkills.find((entry) => entry.id === at) ?? null

  const toggleOpen = (id: string) => {
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const toggleGroup = (tab: string) => {
    setShut((prev) => ({ ...prev, [tab]: !prev[tab] }))
  }

  /*
    the leader: a pip standing beside the hit the formula is reading, in the
    channel between the list and the card, so the two are visibly one reading.
    it travels with the pick, and
    it follows the list's own height, since a skill put away or a drawer opened
    moves the row under it.
  */
  const bay = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const pip = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const wrap = bay.current
    const mark = pip.current
    const rows = list.current
    if (!wrap || !mark || !rows) return

    return observeSelectionPip(wrap, rows, mark, at)
    /* the list is watched as well as the pick: pointing the column at another
       member re-lists the kit under a leader that was never unmounted, and a
       kit of the same height would otherwise leave it standing on the row it
       read for the member before */
  }, [at, groups])

  if (!simulation || groups.length === 0) {
    return <p className="pgs-empty">This build has no damage to report yet.</p>
  }

  return (
    <div className="pgd" ref={bay}>
      <i className="pgd-pip" ref={pip} aria-hidden="true" />
      <div className="pgd-list" ref={list}>
        {groups.map(([tab, entries]) => {
          const head = entries[0]
          const element = ATTR_COLORS[head.skill.element] ?? 'var(--resonator-accent)'

          const title = getTabTitle(head.skill)
          const isShut = Boolean(shut[tab])
          const bodyId = `pgd-${runtime.id}-${tab}`

          return (
            <section className="pgd-grp" key={tab} data-shut={isShut ? 'true' : 'false'} style={{ '--el': element } as CssVars}>
              {/* the sticky head keys the column and names each skill once.
                  its art well also folds the skill section. */}
              <header className="pgd-ghead">
                <button
                  type="button" className="pgd-gwell"
                  aria-expanded={!isShut}
                  aria-controls={bodyId}
                  title={isShut ? `Show ${title}` : `Hide ${title}`}
                  onClick={() => toggleGroup(tab)}
                >
                  <i style={glyphVars(tabGlyph(runtime.id, tab), '--g')} aria-hidden="true" />
                  <span className="pgd-gwell-lbl">{isShut ? `Show ${title}` : `Hide ${title}`}</span>
                </button>
                <span className="pgd-gname">
                  <b>{title}</b>
                </span>

                {/* a folded section shows the retained hit count in its head. */}
                {isShut ? (
                  <span className="pgd-gcount">
                    {entries.length} hit{entries.length > 1 ? 's' : ''}
                  </span>
                ) : (
                  <>
                    <span className="pgd-gkey">Normal</span>
                    <span className="pgd-gkey">Crit</span>
                    <span className="pgd-gkey is-avg">Avg</span>
                  </>
                )}
                <span />
              </header>

              <Expandable
                as="div" className="pgd-gbody"
                id={bodyId}
                contentOnly
                open={!isShut}
                innerClass="pgd-gbody-in"
              >
                {entries.map((entry) => (
                  <DamageRow
                    key={entry.id}
                    entry={entry}
                    at={entry.id === at}
                    open={Boolean(open[entry.id])}
                    onPick={setPicked}
                    onOpen={toggleOpen}
                  />
                ))}
              </Expandable>
            </section>
          )
        })}
      </div>

      {atEntry ? (
        <FormulaCard entry={atEntry} simulation={simulation} runtime={runtime} enemy={enemy} />
      ) : null}
    </div>
  )
}
