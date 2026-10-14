/*
  Author: Runor Ewhro
  description: resolves and displays runtime-prepared skill data, parameters, hits, and effect descriptions.
*/

import { DisplayImage } from '@/shared/ui/DisplayImage'
import { Fragment, type CSSProperties, type MouseEvent, useMemo, useState } from 'react'
import type { SkillTabKey } from '@/domain/entities/resonator'
import type { ResRuntime } from '@/domain/entities/runtime'
import { AppModal } from '@/shared/ui/AppModal'
import { RichDscr } from '@/modules/simulation/ui/RichDescription'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import { resNodeIcon, resSeqIcon, type ResNodeKey } from '@/shared/lib/gameAssets'
import { Expandable } from '@/shared/ui/Expandable'
import { getResonator, getResDtls, type ResView } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display.ts'
import { withDefResMg } from '@/shared/lib/imageFallback.ts'
import {
  fmtSkllKey,
  mrgDscrKywr,
  skllLblMap,
} from '@/modules/simulation/features/resonator/lib/panel.ts'
import { useMobileUi } from '@/shared/responsive/mobileUi'
import { MobilePages } from '@/shared/ui/mobile/MobilePages'
import { BookOpen, List } from 'lucide-react'

const CONCERTO_TABS: SkillTabKey[] = ['introSkill', 'outroSkill']

type SkdView = SkillTabKey | 'concerto' | 'chains'

interface RailEntry {
  view: SkdView
  label: string
  /* rail art: skills use node glyphs; the chain uses its first sequence icon. */
  glyph: string
  keys: SkillTabKey[]
  count: number
}

function viewOfTab(tab: SkillTabKey): SkdView {
  return CONCERTO_TABS.includes(tab) ? 'concerto' : tab
}

interface ResSkllDataM {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  resonatorId: string | null
  runtime: ResRuntime | null
  requestedTab?: SkillTabKey | null
  roster?: ResView[]
  onSwitchMember?: (resonatorId: string) => void
  onClose: () => void
}

export function SkillData({
  visible,
  open,
  closing = false,
  resonatorId,
  runtime,
  requestedTab = null,
  roster = [],
  onSwitchMember,
  onClose,
}: ResSkllDataM) {
  const resonator = useMemo(() => (resonatorId ? getResonator(resonatorId) : null), [resonatorId])
  const details = useMemo(() => (resonatorId ? getResDtls(resonatorId) : null), [resonatorId])
  const curSldrClr = ATTR_COLORS[resonator?.attribute ?? 'physical'] ?? '#888'

  // a single concerto entry and the pane prints both.
  const [actView, setActView] = useState<SkdView>(() => viewOfTab(requestedTab ?? 'normalAttack'))
  const mobile = useMobileUi()
  const [mPage, setMPage] = useState('skill')
  const railJump = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('.skd-fold__chev')) return
    if (target.closest('.amdl__tab, .skd-kid')) setMPage('skill')
  }

  const tabs = useMemo(() => details?.skillTabs ?? [], [details])
  const chains = useMemo(() => details?.resonanceChains ?? [], [details])

  const railEntries = useMemo(() => {
    if (!resonatorId) {
      return []
    }

    const out: RailEntry[] = []
    let concertoDone = false
    for (const tab of tabs) {
      if (CONCERTO_TABS.includes(tab)) {
        if (concertoDone) continue
        concertoDone = true
        const keys = CONCERTO_TABS.filter((key) => tabs.includes(key))
        out.push({
          view: 'concerto',
          label: 'Concerto',
          glyph: resNodeIcon(resonatorId, 'introSkill'),
          keys,
          count: keys.reduce((n, key) => n + (details?.skillsByTab[key]?.multipliers.length ?? 0), 0),
        })
        continue
      }
      out.push({
        view: tab,
        label: skllLblMap[tab] ?? fmtSkllKey(tab),
        glyph: resNodeIcon(resonatorId, tab as ResNodeKey),
        keys: [tab],
        count: details?.skillsByTab[tab]?.multipliers.length ?? 0,
      })
    }

    /* show the chain after skill multipliers. */
    if (chains.length > 0) {
      out.push({
        view: 'chains',
        label: 'Resonance Chain',
        glyph: resSeqIcon(resonatorId, 1),
        keys: [],
        count: chains.length,
      })
    }

    return out
  }, [tabs, details, chains, resonatorId])

  const rslvView: SkdView =
    railEntries.some((entry) => entry.view === actView)
      ? actView
      : (railEntries[0]?.view ?? actView)

  const shownKeys = railEntries.find((entry) => entry.view === rslvView)?.keys ?? []
  const shownSkills = shownKeys
      .map((key) => ({ key, skill: details?.skillsByTab[key] }))
      .filter((entry): entry is { key: SkillTabKey; skill: NonNullable<typeof entry.skill> } => Boolean(entry.skill))

  const inherents = details?.inherentSkills ?? []
  const lvlOfTab = (key: SkillTabKey) =>
    runtime && key !== 'outroSkill' ? runtime.base.skillLevels[key] ?? null : null

  const inhDomId = (order: number) => `skd-inh-${resonatorId}-${order}`

  /* the rail entry selects the tab; a child jumps to the one it names */
  const openInherent = (order: number) => {
    setActView('forteCircuit')
    window.requestAnimationFrame(() => {
      document.getElementById(inhDomId(order))?.scrollIntoView({ block: 'nearest' })
    })
  }

  if (!visible || !resonatorId) {
    return null
  }

  const mHeader = (
    <>
        <ModalHeader over="Skill Data" title={<h2>{resonator?.name ?? resonatorId}</h2>} onClose={onClose}>
            {onSwitchMember && roster.length > 1 ? (
              <div className="mcc-switch skills-modal-switch" role="group" aria-label="Switch resonator view">
                {roster.map((mate) => {
                  const isCurrent = mate.id === resonatorId
                  const label = isCurrent ? `${mate.name} (current view)` : `Switch to ${mate.name}`
                  return (
                    <button
                      key={mate.id}
                      type="button"
                      className={`mcc-switch-chip${isCurrent ? ' active' : ''}`}
                      style={{ '--mcc-switch-accent': ATTR_COLORS[mate.attribute] } as CSSProperties}
                      aria-pressed={isCurrent}
                      aria-label={label}
                      title={label}
                      onClick={() => {
                        if (!isCurrent) {
                          onSwitchMember(mate.id)
                        }
                      }}
                    >
                      <DisplayImage src={mate.profile} alt="" onError={withDefResMg} />
                    </button>
                  )
                })}
              </div>
            ) : null}
        </ModalHeader>
    </>
  )

  const mRail = (
          <nav className="amdl__rail" aria-label="Skills">
            {railEntries.map((entry) => {
              const tab = (
                <button
                  type="button"
                  className={rslvView === entry.view ? 'amdl__tab is-on' : 'amdl__tab'}
                  onClick={() => setActView(entry.view)}
                >
                  <span className="skd-glyph"
                    style={{ '--node': `url("${entry.glyph}")` } as CSSProperties}
                    aria-hidden="true"
                  />
                  <span className="amdl__tab-label">{entry.label}</span>
                  <span className="amdl__tab-n">{entry.count || ''}</span>
                </button>
              )

              /* the forte circuit includes inherents in game, so its rail
                 entry folds open to them. the row still selects the tab; the
                 chevron is the only part that answers the fold. */
              if (entry.view === 'forteCircuit' && inherents.length > 0) {
                return (
                  <Expandable
                    key={entry.view} className="skd-fold"
                    triggerClass="skd-fold__head"
                    chevWrapClass="skd-fold__chev"
                    chevronSize={11}
                    innerClass="skd-fold__kids"
                    plainTrigger
                    noHeaderWrap
                    header={tab}
                  >
                    {inherents.map((inherent, order) => {
                      const locked =
                        typeof runtime?.base.level === 'number' &&
                        runtime.base.level < inherent.unlockLevel
                      return (
                        <button
                          key={inherent.ownerKey ?? `inherent-${inherent.unlockLevel}-${inherent.name}`}
                          type="button"
                          className={locked ? 'skd-kid is-locked' : 'skd-kid'}
                          onClick={() => openInherent(order)}
                        >
                          <span className="skd-glyph"
                            style={{
                              '--node': `url("${resNodeIcon(resonatorId, order === 0 ? 'inherent1' : 'inherent2')}")`,
                            } as CSSProperties}
                            aria-hidden="true"
                          />
                          <span className="skd-kid__label">{inherent.name}</span>
                        </button>
                      )
                    })}
                  </Expandable>
                )
              }

              return <Fragment key={entry.view}>{tab}</Fragment>
            })}
            <span className="amdl__rail-foot">
              {tabs.length} skills
              {inherents.length > 0 ? ` · ${inherents.length} inherent` : ''}
              {chains.length > 0 ? ` · ${chains.length} chain` : ''}
            </span>
          </nav>
  )

  const mPane = (
          <div className="amdl__pane">
            {rslvView === 'chains' ? (
              /*
                the chain is read, not set: this is the catalogue's own text
                for every node, regardless of the current build, so no node is dimmed or
                called locked here.
              */
              chains.map((chain) => {
                return (
                  <div
                    key={chain.ownerKey ?? `chain-${chain.index}`} className="amdl__grp skd-seq"
                  >
                    <div className="amdl__grp-name">
                      <span className="skd-glyph"
                        style={{ '--node': `url("${resSeqIcon(resonatorId, chain.index)}")` } as CSSProperties}
                        aria-hidden="true"
                      />
                      {chain.name}
                      <span className="amdl__grp-n">{`S${chain.index}`}</span>
                    </div>
                    <div className="amdl__prose">
                      <RichDscr
                        description={chain.desc}
                        params={chain.param}
                        accentColor={curSldrClr}
                        xtrKywr={mrgDscrKywr(details?.descriptionKeywords, chain.keywords)}
                      />
                    </div>
                  </div>
                )
              })
            ) : shownSkills.length > 0 ? (
              <>
                {shownSkills.map(({ key, skill }) => {
                  const level = lvlOfTab(key)
                  const valueIdx = typeof level === 'number' ? level - 1 : -1
                  return (
                    <Fragment key={key}>
                      <div className="amdl__grp">
                        <div className="amdl__grp-name">
                          {skill.name}
                          <span className="amdl__grp-n">
                            {rslvView === 'concerto' ? skllLblMap[key] ?? fmtSkllKey(key) : null}
                            {rslvView === 'concerto' && typeof level === 'number' ? ' · ' : null}
                            {typeof level === 'number' ? `Lv ${level}` : null}
                          </span>
                        </div>
                        <div className="amdl__prose">
                          <RichDscr
                            description={skill.desc}
                            params={skill.param}
                            accentColor={curSldrClr}
                            xtrKywr={mrgDscrKywr(details?.descriptionKeywords, skill.keywords)}
                          />
                        </div>
                      </div>

                      {skill.multipliers.length > 0 ? (
                        <div className="amdl__grp">
                          <div className="amdl__grp-name">
                            Multipliers
                            <span className="amdl__grp-n">{skill.multipliers.length}</span>
                          </div>
                          {skill.multipliers.map((multiplier, index) => (
                            <div key={`${multiplier.label}-${index}`} className="amdl__row">
                              <span className="amdl__row-k">{multiplier.label}</span>
                              <span className="amdl__row-v">
                                {valueIdx >= 0 ? multiplier.values[valueIdx] ?? 'N/A' : 'N/A'}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </Fragment>
                  )
                })}

                {rslvView === 'forteCircuit'
                  ? inherents.map((inherent, order) => {
                    const locked =
                      typeof runtime?.base.level === 'number' &&
                      runtime.base.level < inherent.unlockLevel
                    return (
                      <div
                        key={inherent.ownerKey ?? `inherent-${inherent.unlockLevel}-${inherent.name}`}
                        id={inhDomId(order)}
                        className={locked ? 'amdl__grp skd-inh is-locked' : 'amdl__grp skd-inh'}
                      >
                        <div className="amdl__grp-name">
                          <span className="skd-glyph"
                            style={{
                              '--node': `url("${resNodeIcon(resonatorId, order === 0 ? 'inherent1' : 'inherent2')}")`,
                            } as CSSProperties}
                            aria-hidden="true"
                          />
                          {inherent.name}
                          <span className="amdl__grp-n">
                            {locked ? `Locked · Lv ${inherent.unlockLevel}` : `Lv ${inherent.unlockLevel}`}
                          </span>
                        </div>
                        <div className="amdl__prose">
                          <RichDscr
                            description={inherent.desc}
                            params={inherent.param}
                            accentColor={curSldrClr}
                            xtrKywr={mrgDscrKywr(details?.descriptionKeywords, inherent.keywords)}
                          />
                        </div>
                      </div>
                    )
                  })
                  : null}
              </>
            ) : (
              <p className="amdl__prose">No skill data is available for this tab.</p>
            )}
          </div>
  )


  return (
    <AppModal
      state={{ visible, open, closing: closing ?? false }}
      variant="skills"
      ariaLabel="Skill data"
      style={{
        '--modal-accent': curSldrClr,
        '--resonator-accent': curSldrClr,
      } as CSSProperties}
      onClose={onClose}
    >
      {mobile ? (
        <MobilePages
          className=""
          head={mHeader}
          pages={[
            { id: 'skill', label: 'Skill', icon: <BookOpen />, node: mPane },
            { id: 'list', label: 'All skills', icon: <List />, node: <div className="skd-mrail" onClick={railJump}>{mRail}</div> },
          ]} page={mPage} onPage={setMPage}
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
      <div className="amdl" onClick={(event) => event.stopPropagation()}>
        {mHeader}
        <div className="amdl__body skill-data__body">
          {mRail}
          {mPane}
        </div>
      </div>
      )}
    </AppModal>
  )
}
