/*
  Author: Runor Ewhro
  description: derives the active main-echo skill and ordered sonata tier states
               for one loadout.
*/

import { useMemo } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime'
import { DisplayImage } from '@/shared/ui/DisplayImage'
import { getEchoById } from '@/data/catalog/echoCatalogService.ts'
import { getSntSetIco } from '@/data/gameData/catalog/sonataSets.ts'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects.ts'
import type { SetDef } from '@/data/gameData/echoSets/effects.ts'
import { cmptSetCnts } from '@/modules/simulation/features/echoes/lib/echoPane.ts'
import { RichDscr } from '@/modules/simulation/ui/RichDescription.tsx'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'

const TIER_PIECES: Array<[keyof SetDef['desc'], number]> = [
  ['onePiece', 1],
  ['twoPiece', 2],
  ['threePiece', 3],
  ['fivePiece', 5],
]

interface SetReadout {
  id: number
  name: string
  icon: string | null
  count: number
  tiers: Array<{ pieces: number; desc: string }>
}

/** one set's name, icon and every tier it defines, lowest threshold first. */
export function readSetTiers(id: number): Omit<SetReadout, 'count'> | null {
  const def = getEchoSetDe(id)
  if (!def) return null
  const tiers = TIER_PIECES.flatMap(([tier, pieces]) => {
    const desc = def.desc[tier]
    return desc ? [{ pieces, desc }] : []
  })
  return tiers.length ? { id: def.id, name: def.name, icon: getSntSetIco(def.id), tiers } : null
}

// retain later thresholds once a set activates so callers can distinguish met
// and unmet tiers within the same set.
function readSets(echoes: Array<EchoInstance | null>): SetReadout[] {
  return Object.entries(cmptSetCnts(echoes))
    .flatMap(([key, count]) => {
      const set = readSetTiers(Number(key))
      if (!set || count < set.tiers[0].pieces) return []
      return [{ ...set, count }]
    })
    .sort((a, b) => b.count - a.count)
}

export function hasLoadoutEffects(echoes: Array<EchoInstance | null>): boolean {
  return echoes.some(Boolean)
}

export function LoadoutEffects({ echoes }: { echoes: Array<EchoInstance | null> }) {
  const mainEcho = useMemo(() => {
    const echo = echoes.find((entry) => entry?.mainEcho) ?? echoes[0] ?? echoes.find(Boolean)
    return echo ? getEchoById(echo.id) : null
  }, [echoes])
  const sets = useMemo(() => readSets(echoes), [echoes])

  return (
    <>
      {mainEcho ? (
        <section className="lho-fx-part">
          <h4 className="lho-fx-head">Echo skill</h4>
          <span className="lho-fx-echo">
            <DisplayImage src={mainEcho.icon} alt="" className="lho-fx-echo-icon" decoding="async" onError={withDefIconM} />
            <strong>{mainEcho.name}</strong>
          </span>
          {mainEcho.skillDesc ? <RichDscr description={mainEcho.skillDesc} className="rich-description lho-fx-desc" /> : null}
        </section>
      ) : null}

      <section className="lho-fx-part">
        <h4 className="lho-fx-head">Sonata effect</h4>
        {sets.length ? sets.map((set) => (
          <div key={set.id} className="lho-fx-set">
            {set.tiers.map((tier) => {
              const on = set.count >= tier.pieces
              return (
                <div key={tier.pieces} className="lho-fx-tier" data-on={on ? 'true' : undefined}>
                  <span className="lho-fx-mark" role="img" aria-label={on ? 'Active' : 'Not active'} />
                  <div className="lho-fx-tier-body">
                    <span className="lho-fx-tier-head">
                      {set.icon ? (
                        <DisplayImage src={set.icon} alt="" className="lho-fx-glyph" decoding="async" onError={withDefIconM} />
                      ) : null}
                      {set.name}
                      <span className="lho-fx-count">({Math.min(set.count, tier.pieces)}/{tier.pieces})</span>
                    </span>
                    <RichDscr description={tier.desc} className="rich-description lho-fx-desc" />
                  </div>
                </div>
              )
            })}
          </div>
        )) : (
          <p className="lho-fx-empty">No set reaches its first tier yet.</p>
        )}
      </section>
    </>
  )
}
