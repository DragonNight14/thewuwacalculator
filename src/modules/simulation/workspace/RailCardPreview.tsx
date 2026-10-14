/*
  Author: Runor Ewhro
  description: renders a build-rail preview on Home using the evaluation rail,
               a resonator portrait, and setup art without build data. it
               includes a Live2D toggle.
*/

import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { useRef } from 'react'
import type { ResSeed } from '@/domain/entities/runtime'
import { DEF_SHOWCASE_HIDE } from '@/domain/entities/preferences'
import { spriteVars } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { getEvaluationSpinePlacement } from '@/shared/spine/placement'
import { BuildRail, type BuildRailModel } from '@/modules/simulation/workspace/BuildRail.tsx'

export function RailCardPreview({ resId, animated }: { resId: string; animated: boolean }) {
  const cardRef = useRef<HTMLElement | null>(null)

  const res = getResSeedBy(resId)
  const accent = res ? ATTR_COLORS[res.attribute] ?? '#6b7cff' : '#6b7cff'
  const portraitSrc = res?.sprite ?? res?.profile ?? '/assets/game/default.webp'

  const railModel: BuildRailModel = {
    runtime: null,
    seed: res
      ? ({
          name: res.name,
          attribute: res.attribute,
          rarity: res.rarity,
          sprite: res.sprite,
          profile: res.profile,
          weaponType: res.weaponType,
        } as unknown as ResSeed)
      : null,
    rarity: res?.rarity ?? 5,
    accent,
    attrIcon: getAttributeIconSrc(res?.attribute),
    portraitSrc,
    spriteCss: spriteVars(res),
    weaponState: null,
    weapon: null,
    weaponName: 'No Weapon',
    weaponRarity: null,
    weaponIcon: null,
    sonataSets: [],
    teamSupports: [],
  }

  return (
    <div className="rail-preview">
          <BuildRail
            buildCardRef={cardRef}
            isShowcase={false}
            customCss={null}
            railPhase="idle"
            editMode={null}
            railResId={resId}
            railModel={railModel}
            cardHidden={{
              ...DEF_SHOWCASE_HIDE,
              brand: true,
              portraitCredit: true,
              backdropCredit: true,
            }}
            railStyle={{ '--resonator-accent': accent }}
            backdropStyle={{}}
            statsColumn="both"
            portraitCredit={null}
            backdropCredit={null}
            resolvedPortrait={null}
            animatedPortraits={animated}
            editable={false}
            showcasePlacement={getEvaluationSpinePlacement(resId)}
            score={null}
            grade={null}
            tone={accent}
            showcaseBuild={null}
            showcaseAvgDamage={null}
            autoImageContrast={false}
          />
    </div>
  )
}
