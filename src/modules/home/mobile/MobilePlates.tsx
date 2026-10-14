/*
  Author: Runor Ewhro
  description: builds mobile home entries from catalog, release, status, and
               resonator-selection state.
*/

import { useState } from 'react'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger'
import { Newspaper } from 'lucide-react'
import { TbMathFunction } from 'react-icons/tb'
import { DisplayImage } from '@/shared/ui/DisplayImage'
import AppLoaderOverlay from '@/shared/ui/AppLoaderOverlay'
import { AxLink, useNavX } from '@/shared/navigation/useNavX'
import { setUiMode } from '@/shared/responsive/mobileUi'
import { APP_ROUTES, SIMULATION_ROUTES } from '@/shared/lib/appRoutes'
import { useAppStore } from '@/application/state'
import { STATE_LABELS, STATUS_DATA } from '@/data/content/appStatus'
import type { WnEntry } from '@/data/content/changelogEntries'
import type { ArrivedResonator, Arrivals } from '@/modules/home/model/arrivals'
import type { useCoverage } from '@/modules/home/model/useCoverage'

type Coverage = ReturnType<typeof useCoverage>

export function DevPlate({ coverage }: { coverage: Coverage }) {
  const [covOpen, setCovOpen] = useState(false)
  const covered = coverage.filter((domain) => domain.status === 'ok').length
  const stable = STATUS_DATA.overallState === 'stable'

  return (
    <div className="mh-pad">
      <p className="mh-state">{STATE_LABELS[STATUS_DATA.overallState]}</p>
      <p className="mh-k">
        <i className={`mh-dot${stable ? '' : ' is-warn'}`} aria-hidden="true" />
        From the dev · {STATUS_DATA.lastUpdated}
      </p>
      <h2 className="mh-hey">{STATUS_DATA.notes[0]}</h2>
      {STATUS_DATA.notes.slice(1).map((note) => <p className="mh-line" key={note}>{note}</p>)}

      {STATUS_DATA.recentChanges.length > 0 ? (
        <div className="mh-latest">
          <b>{STATUS_DATA.recentChanges.length === 1 ? 'Latest' : 'Lately'}</b>
          <ul>{STATUS_DATA.recentChanges.map((one) => <li key={one}>{one}</li>)}</ul>
        </div>
      ) : null}

      {covOpen ? (
        <div className="mh-cov">
          {coverage.map((domain) => (
            <div className="mh-cov__row" key={domain.key}>
              <span>{domain.title}{domain.status !== 'ok' && domain.note ? <em>{domain.note}</em> : null}</span>
              <b className={domain.status === 'ok' ? undefined : 'is-down'}>
                {domain.count === null ? '-' : domain.count.toLocaleString()}
                {domain.extra ? <u> · {domain.extra}</u> : null}
              </b>
            </div>
          ))}
        </div>
      ) : null}

      <p className="mh-stamp">
        <span>Patch <b>v{STATUS_DATA.patchVersion}</b></span>
        <button type="button" aria-expanded={covOpen} onClick={() => setCovOpen((open) => !open)}>
          Coverage <b>{covered}/{coverage.length}</b>
        </button>
        <span>Issues <b>{STATUS_DATA.knownIssues.length}</b></span>
      </p>
    </div>
  )
}

function Figure({ who }: { who: ArrivedResonator }) {
  const [src, setSrc] = useState(who.artFallback ?? who.art)

  return (
    <img
      src={src}
      alt=""
      onError={() => {
        if (src !== who.art) setSrc(who.art)
      }}
    />
  )
}

export function ResonatorPlate({ who }: { who: ArrivedResonator }) {
  const swapResonator = useAppStore((state) => state.swRes)
  const nav = useNavX()

  return (
    <>
      <div className="mh-art" aria-hidden="true">
        <Figure who={who} key={who.artFallback ?? who.art} />
      </div>
      <div className="mh-pad mh-pad--under">
        <span className="mh-attr">
          <i aria-hidden="true" />
          {['New', who.attributeName, who.weaponName].filter(Boolean).join(' · ')}
        </span>
        <h2 className="mh-name">{who.name}</h2>
        {who.signature ? (
          <div className="mh-sig">
            {who.signature.icon ? <DisplayImage src={who.signature.icon} alt="" /> : null}
            <span>
              <em>Signature</em>
              <strong>{who.signature.name}</strong>
            </span>
          </div>
        ) : null}
        {who.held ? (
          <ContextTrigger asChild ariaLabel={`${who.name} actions`} items={[{
            id: `mobile-home:build:${who.id}`,
            label: `Build ${who.name}`,
            icon: <TbMathFunction size="1em" />,
            onSelect: () => { swapResonator(who.id); nav(SIMULATION_ROUTES.modulation) },
          }]}>
          <button
            type="button"
            className="mh-go"
            onClick={() => {
              swapResonator(who.id)
              nav(SIMULATION_ROUTES.modulation)
            }}
          >
            Build {who.name}
          </button>
          </ContextTrigger>
        ) : null}
      </div>
    </>
  )
}

export function AlsoPlate({ arrivals }: { arrivals: Arrivals }) {
  const signatures = new Set(arrivals.resonators.map((who) => who.signature?.id).filter(Boolean))
  const weapons = arrivals.weapons.filter((weapon) => !signatures.has(weapon.id))

  return (
    <div className="mh-pad">
      <p className="mh-k">
        Also in {arrivals.live}{arrivals.hotfix ? ` · hotfix ${arrivals.hotfix}` : ''}
      </p>
      <h2 className="mh-hey mh-hey--sm">Latest additions~ ( ˘͈ ᵕ ˘͈♡)</h2>
      <div className="mh-cells">
        {weapons.map((weapon) => (
          <div className="mh-cell" key={weapon.id}>
            {weapon.icon ? <DisplayImage src={weapon.icon} alt="" /> : null}
            <span><em>New weapon</em><strong>{weapon.name}</strong></span>
          </div>
        ))}
        {arrivals.echoes.map((echo) => (
          <div className="mh-cell" key={echo.id}>
            {echo.icon ? <DisplayImage src={echo.icon} alt="" /> : null}
            <span><em>New echo</em><strong>{echo.name}</strong></span>
          </div>
        ))}
        {arrivals.enemies > 0 ? (
          <div className="mh-cell">
            <span className="mh-cell__n">{arrivals.enemies}</span>
            <span><em>New enemies</em><strong>all measurable</strong></span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function FeedPlate({ missing }: { missing: boolean }) {
  return (
    <div className="mh-pad">
      <p className="mh-k">Just arrived</p>
      <h2 className="mh-hey mh-hey--sm">Latest additions~ ( ˘͈ ᵕ ˘͈♡)</h2>
      {missing ? (
        <p className="mh-line">
          Nanoka is not answering right now, so there is nothing to show here.
          The <AxLink to={APP_ROUTES.changelog}>changelog</AxLink> has what landed.
        </p>
      ) : (
        <AppLoaderOverlay mode="inline" text="Checking the latest additions..." />
      )}
    </div>
  )
}

export function NewsPlate({ entries }: { entries: WnEntry[] }) {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div className="mh-pad">
      <p className="mh-k">What&rsquo;s new</p>
      <div className="mh-news">
        {entries.slice(0, 3).map((entry) => (
          <ContextTrigger asChild key={entry.id} ariaLabel={`${entry.title} release actions`} items={[{
            id: `mobile-home:release:${entry.id}`,
            label: open === entry.id ? 'Collapse release' : 'Read release',
            icon: <Newspaper size="1em" />,
            onSelect: () => setOpen((at) => (at === entry.id ? null : entry.id)),
          }]}>
          <button
            type="button"
            className={`mh-entry${open === entry.id ? ' is-open' : ''}`}
            aria-expanded={open === entry.id}
            onClick={() => setOpen((at) => (at === entry.id ? null : entry.id))}
          >
            <span className="mh-entry__sig">{entry.signal} · {entry.tag}</span>
            <b>{entry.title}</b>
            <small>{open === entry.id ? entry.lede : entry.summary}</small>
          </button>
          </ContextTrigger>
        ))}
      </div>
      <p className="mh-stamp mh-stamp--links">
        <AxLink to={APP_ROUTES.privacy}>Privacy</AxLink>
        <AxLink to={APP_ROUTES.terms}>Terms</AxLink>
        <a href="https://discord.gg/wNaauhE4uH" target="_blank" rel="noopener noreferrer">Discord</a>
        <a href="https://ko-fi.com/ssjrunor" target="_blank" rel="noopener noreferrer">Ko-fi</a>
        <button type="button" onClick={() => setUiMode('desktop')}>Desktop site</button>
      </p>
    </div>
  )
}
