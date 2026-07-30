/*
  Author: Runor Ewhro
  Description: Derives toolbar team seats from active/runtime state and routes
               slot edits, active swaps, and teammate console requests.
*/

import {
  type CSSProperties as CssProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { BookOpen, ChevronDown as ChvrnDwn, Plus, RefreshCw, SlidersHorizontal as SldrHrzn, X } from 'lucide-react'
import { selWorkDrvd } from '@/domain/state/selectors.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { RES_MENU, getResonator, type ResView } from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { ResPckr } from '@/modules/calculator/features/resonator/Picker.tsx'
import { SkillData } from '@/modules/calculator/features/resonator/SkillData.tsx'
import { ATTR_COLORS } from '@/modules/calculator/model/display.ts'
import { eligibleForSlot, useTeamSlots } from '@/modules/calculator/features/teams/lib/teamSlots.ts'
import { useTeamCnsl } from '@/modules/calculator/features/teams/lib/teamConsoleStore.ts'
import { withDefResMg } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'

// matches the drawer's exit transition in toolbar-team.css
const DRAWER_EXIT_MS = 160

type PickTarget = { kind: 'active' } | { kind: 'slot'; slot: number }

interface SeatView {
  slot: number
  id: string
  name: string
  profile: string | undefined
  attribute: string
  level: number
  sequence: number
}

export function ToolbarTeam() {
  const { actRt: runtime, partRtsById: partRntmById } = useAppStore(selWorkDrvd)
  const swtcToRes = useAppStore((state) => state.swRes)
  const { setMember } = useTeamSlots()
  const openConsole = useTeamCnsl((state) => state.open)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerOut, setDrawerOut] = useState(false)
  const [litSlot, setLitSlot] = useState<number | null>(null)
  const [pickTarget, setPickTarget] = useState<PickTarget | null>(null)
  const [skillResId, setSkillResId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const exitRef = useRef<number | null>(null)
  const picker = useAppModal()
  const { closing: pckrClsn, hide: hidePckr, open: pckrOpen, show: showPckr, visible: pckrVsbl } = picker
  const skills = useAppModal()
  const { closing: sklsClsn, hide: hideSkls, open: sklsOpen, show: showSkls, visible: sklsVsbl } = skills

  const seats = useMemo<Array<SeatView | null>>(() => {
    if (!runtime) {
      return [null, null, null]
    }

    return [0, 1, 2].map((slot) => {
      const memberId = slot === 0 ? runtime.id : runtime.build.team[slot]
      if (!memberId) {
        return null
      }

      const member = getResonator(memberId)
      const memberRt = slot === 0 ? runtime : partRntmById[memberId] ?? null
      if (!member || !memberRt) {
        return null
      }

      return {
        slot,
        id: memberId,
        name: member.name,
        profile: member.profile,
        attribute: member.attribute,
        level: memberRt.base.level,
        sequence: memberRt.base.sequence,
      }
    })
  }, [partRntmById, runtime])

  // Skill-data lookup is limited to materialized team members so the modal can
  // resolve each candidate's runtime-specific tab data.
  const skillRoster = useMemo<ResView[]>(() => (
    seats.flatMap((seat) => {
      if (!seat) {
        return []
      }

      const view = getResonator(seat.id)
      return view ? [view] : []
    })
  ), [seats])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setLitSlot(null)
    setDrawerOut(drawerOpen)
  }, [drawerOpen])

  const openDrawer = useCallback((slot: number | null) => {
    setDrawerOut(false)
    setDrawerOpen(true)
    setLitSlot(slot)
  }, [])

  // the bar keeps its raised stacking until the drawer has finished leaving
  useEffect(() => {
    if (!drawerOut) {
      return
    }

    exitRef.current = window.setTimeout(() => {
      setDrawerOut(false)
      exitRef.current = null
    }, DRAWER_EXIT_MS)

    return () => {
      if (exitRef.current !== null) {
        window.clearTimeout(exitRef.current)
        exitRef.current = null
      }
    }
  }, [drawerOut])

  const closePicker = useCallback(() => {
    hidePckr(() => {
      setPickTarget(null)
    })
  }, [hidePckr])

  const openPicker = useCallback((target: PickTarget) => {
    closeDrawer()
    setPickTarget(target)
    showPckr()
  }, [closeDrawer, showPckr])

  const closeSkills = useCallback(() => {
    hideSkls(() => {
      setSkillResId(null)
    })
  }, [hideSkls])

  const openSkills = useCallback((resonatorId: string) => {
    closeDrawer()
    setSkillResId(resonatorId)
    showSkls()
  }, [closeDrawer, showSkls])

  const openTeammate = useCallback((resonatorId: string) => {
    closeDrawer()
    openConsole(resonatorId)
  }, [closeDrawer, openConsole])

  useEffect(() => {
    if (!drawerOpen) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeDrawer()
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDrawer()
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeDrawer, drawerOpen])

  const seatMenu = useCallback((seat: SeatView | null, slot: number): MenuEntry[] => {
    if (!seat) {
      return [{
        id: 'tps-add',
        label: 'Add a support',
        icon: <Plus size="1em" />,
        onSelect: () => openPicker({ kind: 'slot', slot }),
      }]
    }

    const skillsEntry: MenuEntry = {
      id: 'tps-skills',
      label: `${seat.name}'s skills`,
      icon: <BookOpen size="1em" />,
      onSelect: () => openSkills(seat.id),
    }

    if (slot === 0) {
      return [
        skillsEntry,
        {
          id: 'tps-switch',
          label: 'Switch active resonator',
          icon: <RefreshCw size="1em" />,
          onSelect: () => openPicker({ kind: 'active' }),
        },
      ]
    }

    return [
      skillsEntry,
      {
        id: 'tps-config',
        label: `Configure ${seat.name}`,
        icon: <SldrHrzn size="1em" />,
        onSelect: () => openTeammate(seat.id),
      },
      {
        id: 'tps-swap',
        label: `Swap ${seat.name}`,
        icon: <RefreshCw size="1em" />,
        onSelect: () => openPicker({ kind: 'slot', slot }),
      },
      {
        id: 'tps-remove',
        label: `Remove ${seat.name}`,
        icon: <X size="1em" />,
        danger: true,
        onSelect: () => setMember(slot, null),
      },
    ]
  }, [openPicker, openSkills, openTeammate, setMember])

  if (!runtime) {
    return null
  }

  const filled = seats.filter(Boolean).length
  const openSlot = seats.findIndex((seat, index) => index > 0 && !seat)
  const pickerList = pickTarget?.kind === 'slot'
    ? eligibleForSlot(runtime.build.team, pickTarget.slot)
    : RES_MENU

  const onPick = (resonatorId: string) => {
    if (pickTarget?.kind === 'slot') {
      setMember(pickTarget.slot, resonatorId)
    } else {
      swtcToRes(resonatorId)
    }
    closePicker()
  }

  const shellClass = [
    'tps',
    drawerOpen ? 'is-open' : '',
    drawerOut ? 'is-closing' : '',
  ].filter(Boolean).join(' ')

  const renderTile = (seat: SeatView | null, slot: number) => {
    const isActive = slot === 0
    const className = [
      'tps-tile',
      isActive ? 'is-active' : '',
      seat ? '' : 'is-empty',
      litSlot === slot ? 'is-lit' : '',
    ].filter(Boolean).join(' ')

    return (
      <ContextTrigger
        key={seat?.id ?? `empty-${slot}`}
        ariaLabel={seat ? `${seat.name} actions` : 'Team slot actions'}
        getItems={() => seatMenu(seat, slot)}
      >
        <button
          type="button"
          className={className}
          style={seat ? { '--tps-attr': ATTR_COLORS[seat.attribute as keyof typeof ATTR_COLORS] } as CssProps : undefined}
          title={seat ? `${seat.name}${isActive ? ' (active)' : ''}` : 'Add a support'}
          aria-label={seat
            ? isActive
              ? `Active: ${seat.name}, switch resonator`
              : `${seat.name}, team actions`
            : `Add a support to slot ${slot}`}
          aria-expanded={seat && !isActive ? drawerOpen && litSlot === slot : undefined}
          onClick={() => {
            if (!seat) {
              openPicker({ kind: 'slot', slot })
              return
            }

            // the active seat is the subject of the whole calculator, so it
            // keeps a direct switch instead of routing through the drawer.
            if (isActive) {
              openPicker({ kind: 'active' })
              return
            }

            if (drawerOpen && litSlot === slot) {
              closeDrawer()
              return
            }

            openDrawer(slot)
          }}
        >
          {seat ? (
            <img src={seat.profile} alt="" loading="lazy" onError={withDefResMg} />
          ) : (
            <Plus size="0.7rem" strokeWidth={2.6} aria-hidden="true" />
          )}
        </button>
      </ContextTrigger>
    )
  }

  return (
    <div className={shellClass} ref={rootRef}>
      <div className="tps-triad">
        {seats.map((seat, slot) => renderTile(seat, slot))}

        <button
          type="button"
          className="tps-caret"
          aria-label="Open team actions"
          aria-expanded={drawerOpen}
          title="Team actions"
          onClick={() => (drawerOpen ? closeDrawer() : openDrawer(null))}
        >
          <ChvrnDwn size="0.8rem" aria-hidden="true" />
        </button>
      </div>

      <div
        className={drawerOpen ? 'tps-drawer is-open' : 'tps-drawer'}
        role="group"
        aria-label="Team"
        inert={!drawerOpen}
      >
        <div className="tps-drawer-head">
          <span>Team</span>
          <span>{filled} of 3</span>
        </div>

        {seats.map((seat, slot) => {
          if (!seat) {
            return null
          }

          return (
            <div
              key={seat.id}
              className={litSlot === slot ? 'tps-row is-lit' : 'tps-row'}
              style={{ '--tps-attr': ATTR_COLORS[seat.attribute as keyof typeof ATTR_COLORS] } as CssProps}
            >
              <img className="tps-row-face" src={seat.profile} alt="" loading="lazy" onError={withDefResMg} />
              <span className="tps-row-id">
                <em>{slot === 0 ? 'Active' : 'Support'}</em>
                <b>{seat.name}</b>
                <i>Lv{seat.level} S{seat.sequence}</i>
              </span>
              <span className="tps-row-tools">
                <button
                  type="button"
                  className="tps-tool"
                  title={`${seat.name}'s skills`}
                  aria-label={`View ${seat.name}'s skills`}
                  onClick={() => openSkills(seat.id)}
                >
                  <BookOpen size="0.8125rem" />
                </button>
                {slot === 0 ? (
                  <button
                    type="button"
                    className="tps-tool"
                    title="Switch active resonator"
                    aria-label="Switch active resonator"
                    onClick={() => openPicker({ kind: 'active' })}
                  >
                    <RefreshCw size="0.8125rem" />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="tps-tool"
                      title={`Configure ${seat.name}`}
                      aria-label={`Configure ${seat.name}`}
                      onClick={() => openTeammate(seat.id)}
                    >
                      <SldrHrzn size="0.8125rem" />
                    </button>
                    <button
                      type="button"
                      className="tps-tool"
                      title={`Swap ${seat.name}`}
                      aria-label={`Swap ${seat.name}`}
                      onClick={() => openPicker({ kind: 'slot', slot })}
                    >
                      <RefreshCw size="0.8125rem" />
                    </button>
                    <button
                      type="button"
                      className="tps-tool tps-tool--remove"
                      title={`Remove ${seat.name}`}
                      aria-label={`Remove ${seat.name}`}
                      onClick={() => setMember(slot, null)}
                    >
                      <X size="0.8125rem" strokeWidth={2.6} />
                    </button>
                  </>
                )}
              </span>
            </div>
          )
        })}

        {openSlot > 0 ? (
          <button
            type="button"
            className="tps-row tps-add"
            onClick={() => openPicker({ kind: 'slot', slot: openSlot })}
          >
            <span className="tps-add-face" aria-hidden="true">
              <Plus size="0.875rem" strokeWidth={2.4} />
            </span>
            Add a support
          </button>
        ) : null}
      </div>

      {pckrVsbl && pickTarget ? (
        <ResPckr
          visible={pckrVsbl}
          open={pckrOpen}
          closing={pckrClsn}
          portalTarget={mainPortal()}
          eyebrow={pickTarget.kind === 'active' ? 'Roster' : 'Team Slots'}
          title={pickTarget.kind === 'active' ? 'Select Resonator' : 'Select Teammate'}
          resonators={pickerList}
          selResId={pickTarget.kind === 'active'
            ? runtime.id
            : runtime.build.team[pickTarget.slot] ?? null}
          selLbl={pickTarget.kind === 'active' ? 'Active' : 'Selected'}
          smmrPrmr={pickTarget.kind === 'active'
            ? { label: 'Current', value: seats[0]?.name ?? 'None' }
            : { label: 'Slot', value: pickTarget.slot + 1 }}
          emptyState={<p>No eligible resonators remain for this slot.</p>}
          panelWidth="regular"
          onClose={closePicker}
          onSelect={onPick}
        />
      ) : null}

      {sklsVsbl && skillResId ? (
        <SkillData
          visible={sklsVsbl}
          open={sklsOpen}
          closing={sklsClsn}
          portalTarget={mainPortal()}
          resonatorId={skillResId}
          runtime={skillResId === runtime.id ? runtime : partRntmById[skillResId] ?? null}
          roster={skillRoster}
          onSwitchMember={setSkillResId}
          onClose={closeSkills}
        />
      ) : null}
    </div>
  )
}
