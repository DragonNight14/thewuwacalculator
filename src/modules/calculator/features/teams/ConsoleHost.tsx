/*
  Author: Runor Ewhro
  Description: mounts the teammate console once for the whole shell, deriving
               its runtime, roster, states, and combat stats from the store so
               any surface can open it with just a resonator id.
*/

import { Suspense, lazy, useCallback, useEffect, useMemo } from 'react'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { makeSourceCat } from '@/domain/services/runtimeSourceService.ts'
import { findCombatPart, makeCombatGraph } from '@/domain/state/combatGraph.ts'
import { selActTgtSlc, selEnemyProf, selWorkDrvd } from '@/domain/state/selectors.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext.ts'
import { isSourceVisible } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { makeStatsView } from '@/modules/calculator/model/statsView.ts'
import { mkSelTrgtByR } from '@/modules/calculator/model/teamTargets.ts'
import { getResonator } from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { useTeamCnsl } from '@/modules/calculator/features/teams/lib/teamConsoleStore.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'

const ConfigModal = lazy(async () => ({
  default: (await import('@/modules/calculator/features/teams/ConfigModal.tsx')).ConfigModal,
}))

// the console keeps the shell chunk light by loading only once a request lands,
// and it stays mounted through the exit animation before clearing the request.
export function TeamConsoleHost() {
  const target = useTeamCnsl((state) => state.target)

  if (!target) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <ConsoleView resonatorId={target.resonatorId} />
    </Suspense>
  )
}

function ConsoleView({ resonatorId }: { resonatorId: string }) {
  const channel = useTeamCnsl((state) => state.target?.channel ?? 'loadout')
  const switchMember = useTeamCnsl((state) => state.switchMember)
  const setChannel = useTeamCnsl((state) => state.setChannel)
  const closeRequest = useTeamCnsl((state) => state.close)

  const { actRt: runtime, partRtsById: partRntmById } = useAppStore(selWorkDrvd)
  const enemyProfile = useAppStore(selEnemyProf)
  const selTrgtByOwn = useAppStore(selActTgtSlc)
  const invBlds = useAppStore((state) => state.calculator.inventoryBuilds)
  const profilesById = useAppStore((state) => state.calculator.profiles)
  const updResRt = useAppStore((state) => state.updResRt)
  const setTargetRes = useAppStore((state) => state.setResTgt)

  const { closing, hide, open, show, visible } = useAppModal()

  useEffect(() => {
    show()
  }, [show])

  const closeConsole = useCallback(() => {
    hide(() => {
      closeRequest()
    })
  }, [closeRequest, hide])

  const member = getResonator(resonatorId)
  const memberRt = partRntmById[resonatorId] ?? null

  // the console only edits teammates, so a member that left the team while it
  // was open closes it rather than rendering an empty shell.
  useEffect(() => {
    if (visible && !closing && (!member || !memberRt || !runtime)) {
      closeConsole()
    }
  }, [closeConsole, closing, member, memberRt, runtime, visible])

  const roster = useMemo(() => {
    if (!runtime) {
      return []
    }

    return runtime.build.team.flatMap((memberId, index) => {
      if (index === 0 || !memberId || !partRntmById[memberId]) {
        return []
      }

      const mate = getResonator(memberId)
      return mate ? [mate] : []
    })
  }, [partRntmById, runtime])

  const configStates = useMemo(() => {
    if (!memberRt || !runtime) {
      return []
    }

    // teammate state visibility is evaluated against the active runtime because
    // team-targeted effects depend on the current composition.
    return makeSourceCat(memberRt).states
      .filter((state) => isSourceVisible(memberRt, memberRt, state, runtime))
      .filter((state) => state.source.type !== 'echo')
  }, [memberRt, runtime])

  const cmbtSttsView = useMemo(() => {
    if (!memberRt || !runtime) {
      return null
    }

    const activeSeed = getResSeedBy(runtime.id)
    if (!activeSeed) {
      return null
    }

    const graph = makeCombatGraph({
      actRt: runtime,
      activeSeed,
      partRts: {
        ...partRntmById,
        [memberRt.id]: memberRt,
      },
      targetsByRes: mkSelTrgtByR(runtime.build.team, selTrgtByOwn),
    })

    const targetSlotId = findCombatPart(graph, memberRt.id)
    if (!targetSlotId) {
      return null
    }

    const context = makeCombatEnv({
      graph,
      targetSlotId,
      enemy: enemyProfile,
    })

    return makeStatsView(memberRt, context.finalStats)
  }, [enemyProfile, memberRt, partRntmById, runtime, selTrgtByOwn])

  if (!member || !memberRt || !runtime || !visible) {
    return null
  }

  return (
    <ConfigModal
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={mainPortal()}
      member={member}
      roster={roster}
      runtime={memberRt}
      actRt={runtime}
      invBlds={invBlds}
      sttDefs={configStates}
      cmbtSttsView={cmbtSttsView}
      initChannel={channel}
      onSwitchMember={switchMember}
      onChannelChange={setChannel}
      onSqncChng={(value) =>
        updResRt(member.id, (prev) => ({
          ...prev,
          base: {
            ...prev.base,
            sequence: Math.max(0, Math.min(6, value)),
          },
        }))
      }
      onRtPdt={(updater) => updResRt(member.id, updater)}
      getSelTgt={(ownerKey) => profilesById[runtime.id]?.runtime.routing.selectedTargetsByOwnerKey[ownerKey] ?? null}
      setSelTgt={(ownerKey, tgtResId) => setTargetRes(member.id, ownerKey, tgtResId)}
      onClose={closeConsole}
    />
  )
}
