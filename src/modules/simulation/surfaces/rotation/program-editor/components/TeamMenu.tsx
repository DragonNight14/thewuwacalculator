/*
  Author: Runor Ewhro
  description: aggregates per-member rotation contribution and dispatches
               member, skill, and team-selection actions.
*/

import { flushSync } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {Box, ChevronDown, SlidersHorizontal} from 'lucide-react'
import { useAppStore } from '@/application/state'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import {
  AnchoredAppPopup,
  AppPopupFill,
  AppPopupFooter,
  AppPopupHeader,
  useAppPopupDismiss,
} from '@/shared/ui/AppPopup.tsx'
import { DisplayImage } from '@/shared/ui/DisplayImage'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { DEF_ICON_SRC, withDefResMg } from '@/shared/lib/imageFallback.ts'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay.ts'
import { RES_MENU } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { useSkllData } from '@/modules/simulation/features/resonator/SkillDataHost.tsx'
import { openTeamCnsl } from '@/modules/simulation/features/teams/lib/teamConsoleStore.ts'
import { useTeamSlots } from '@/modules/simulation/features/teams/lib/teamSlots.ts'
import { TeamPicker } from '@/modules/simulation/features/teams/TeamPicker.tsx'

const MENU_BY_ID = new Map(RES_MENU.map((entry) => [entry.id, entry]))
const SEATS = 3

const TEXTURES = ['solid', 'dots', 'hatch'] as const

interface Seat {
  id: string
  name: string
  profile: string
  color: string
  share: number
  texture: (typeof TEXTURES)[number]
  available: boolean
}

export function TeamMenu({ shares }: { shares: Readonly<Record<string, number>> }) {
  const scenario = useAppStore((state) => selectedCombatScenario(state.combat))
  const skillData = useSkllData()
  const { setTeam } = useTeamSlots({ scenarioId: scenario.id })
  const picker = useAppModal()
  const [open, setOpen] = useState(false)
  const [traced, setTraced] = useState<string | null>(null)
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)

  const seats = useMemo<(Seat | null)[]>(() => Array.from({ length: SEATS }, (_, index) => {
    const id = scenario.team.members[index]?.resonatorId
    const entry = id ? MENU_BY_ID.get(id) : null
    if (!id) return null
    return {
      id,
      name: entry?.displayName ?? `Unavailable resonator (${id})`,
      profile: entry?.profile || DEF_ICON_SRC,
      color: entry ? ATTR_COLORS[entry.attribute] ?? ATTR_COLORS.physical : 'var(--muted)',
      share: Math.max(0, Math.min(100, shares[id] ?? 0)),
      texture: TEXTURES[index],
      available: Boolean(entry),
    }
  }), [scenario.team.members, shares])
  const members = seats.filter((seat): seat is Seat => seat !== null)

  useEffect(() => {
    if (open) popupRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [open])

  const close = useCallback(() => {
    setOpen(false)
    setTraced(null)
  }, [])
  useAppPopupDismiss({
    open,
    onDismiss: close,
    hostRef,
    popupRef,
    returnFocusRef: triggerRef,
    pointerEvent: 'mousedown',
  })

  const configure = (id: string) => {
    close()
    openTeamCnsl(id, 'loadout', scenario.id)
  }
  const readSkills = (id: string) => {
    close()
    skillData.openFor(id)
  }
  const pickTeam = () => {
    close()
    picker.show()
  }

  return (
    <span className="rte-team-host" ref={hostRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`rte-team${open ? ' is-on' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Team"
        title="Team"
        onClick={() => setOpen((current) => !current)}
      >
        {seats.map((seat, index) => seat ? (
          <span
            key={seat.id}
            className="rte-team__profile"
            style={{ '--rte-team-share': seat.share, '--rte-res': seat.color } as CSSProperties}
          >
            <DisplayImage src={seat.profile} alt="" onError={withDefResMg} />
          </span>
        ) : (
          <span key={`open-${index}`} className="rte-team__profile-empty" />
        ))}
        <ChevronDown size=".86rem" className="rte-team__chev" aria-hidden="true" />
      </button>

      <AnchoredAppPopup
        visible={open}
        anchorRef={triggerRef}
        popupRef={popupRef}
        align="end"
        preferredPlacement="down"
        maxHeight={420}
        className="rte-team-menu"
        open={open}
        role="dialog"
        aria-label="Team"
      >
        <AppPopupHeader>
          <span>Team</span>
          <AppPopupFill />
          <span className={`rte-team-menu__split${traced ? ' is-traced' : ''}`} aria-hidden="true">
            {members.map((member) => (
              <i
                key={member.id}
                className={`rte-team-menu__tx is-${member.texture}${traced === member.id ? ' is-lit' : ''}`}
                style={{ '--rte-team-share': member.share, '--rte-res': member.color } as CSSProperties}
              />
            ))}
          </span>
        </AppPopupHeader>

        {members.map((member) => (
          <div
            key={member.id}
            className="rte-team-menu__row"
            style={{ '--rte-team-share': member.share, '--rte-res': member.color } as CSSProperties}
            onPointerEnter={() => setTraced(member.id)}
            onPointerLeave={() => setTraced((current) => (current === member.id ? null : current))}
            onFocus={() => setTraced(member.id)}
            onBlur={() => setTraced((current) => (current === member.id ? null : current))}
          >
            <i className={`rte-team-menu__back rte-team-menu__tx is-${member.texture}`} aria-hidden="true" />
            <span className="rte-team-menu__face">
              <DisplayImage src={member.profile} alt="" onError={withDefResMg} />
            </span>
            <b className="rte-team-menu__name" title={member.name}>{member.name}</b>
            <span className="rte-team-menu__keys">
              <button
                type="button"
                className="rte-team-menu__key"
                title={`Configure ${member.name}`}
                aria-label={`Configure ${member.name}`}
                disabled={!member.available}
                onClick={() => configure(member.id)}
              >
                <SlidersHorizontal size=".86rem" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="rte-team-menu__key"
                title={`${member.name}: skill data`}
                aria-label={`${member.name}: skill data`}
                disabled={!member.available}
                onClick={() => readSkills(member.id)}
              >
                 <Box size=".86rem" aria-hidden="true" />
              </button>
            </span>
          </div>
        ))}

        <AppPopupFooter>
          <span>You know what to do.</span>
          <AppPopupFill />
          <button type="button" className="app-popup__action" onClick={pickTeam}>Set team</button>
        </AppPopupFooter>
      </AnchoredAppPopup>

      {picker.visible ? (
        <TeamPicker
          visible={picker.visible}
          open={picker.open}
          closing={picker.closing}
          portalTarget={mainPortal()}
          leadId={scenario.team.members[0].resonatorId}
          team={scenario.team.members.map((member) => member.resonatorId)}
          onClose={() => picker.hide()}
          onCommit={(supports) => {
            // the store write renders synchronously, so commit the closing
            // phase first or the new team remounts an open picker.
            flushSync(() => picker.hide())
            setTeam(supports)
          }}
        />
      ) : null}
    </span>
  )
}
