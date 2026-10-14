/*
  Author: Runor Ewhro
  description: hosts the persistent scenario roster and profile add, select, copy, paste, and removal actions.
*/

import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { Clipboard, Copy, Scissors, Trash2, UserRoundPlus } from 'lucide-react'
import { isSimulationSurfaceRoute } from '@/shared/lib/appRoutes'
import { useAppStore } from '@/application/state'
import { selContextResonatorId } from '@/application/state'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { contextScenarioMember } from '@/domain/entities/combatScenario.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display'

import { openTeamCnsl } from '@/modules/simulation/features/teams/lib/teamConsoleStore.ts'
import { toTitle } from '@/shared/lib/format'
import { useSel } from '@/modules/simulation/lib/sel.tsx'
import { useConfirm } from '@/shared/hooks/useConfirmation.ts'
import { ConfirmHost } from '@/shared/ui/ConfirmationModal.tsx'
import { mainPortal } from '@/shared/lib/portalTarget'
import { getEvaluationTargetCtx } from '@/modules/simulation/workspace/context.tsx'
import { List, type View } from './List.tsx'
import type { Teammate } from './Details.tsx'
import { groupByAttribute, makeEntries } from './model.ts'
import { useResonatorProfileOps } from '../useResonatorProfileOps.ts'
import { useAdd } from './useAdd.tsx'

export function Column() {
  const { pathname } = useLocation()
  /* the route selects roster data through a prop without remounting the column. */
  const view: View = isSimulationSurfaceRoute(pathname, 'rotation') ? 'rotation' : 'build'
  const scenarioLibrary = useAppStore((state) => state.combat)
  const contextResId = useAppStore(selContextResonatorId)
  const selectContextResonator = useAppStore((state) => state.selectContextResonator)

  const roster = useMemo(() => makeEntries(scenarioLibrary), [scenarioLibrary])
  const scenario = useMemo(() => selectedCombatScenario(scenarioLibrary), [scenarioLibrary])

  /* the selected roster details and the team pane open the same console, scoped to
     the lead's scenario and its member copies. */
  const mates = useMemo<Teammate[]>(() => {
    const lead = contextScenarioMember(scenario)
    return scenario.team.members
      .filter((member) => member.id !== lead.id)
      .map((member) => {
        const res = getResSeedBy(member.resonatorId)
        return {
          id: member.resonatorId,
          name: res?.name ?? toTitle(member.resonatorId),
          profile: res?.profile ?? res?.sprite ?? '/assets/game/default.webp',
          accent: ATTR_COLORS[res?.attribute ?? 'aero'],
        }
      })
  }, [scenario])
  const openMember = useCallback((resonatorId: string) => {
    openTeamCnsl(resonatorId, 'loadout', scenario.id)
  }, [scenario.id])
  const groups = useMemo(() => groupByAttribute(roster), [roster])
  const confirmation = useConfirm()
  const ops = useResonatorProfileOps(roster, confirmation)
  const rosterAdd = useAdd()

  const selectionItems = useMemo(() => roster.map(({ id }) => ({ id })), [roster])

  const selectionActions = useMemo(() => [
    {
      id: 'roster:copy',
      key: 'copy' as const,
      needsSel: true,
      icon: <Copy size="1em" />,
      label: ({ count }: { count: number }) => `Copy (${count})`,
      title: 'Copy selected resonators (Ctrl/Cmd+C)',
      run: async ({ ids }: { ids: string[] }) => {
        await ops.copy(ids)
      },
    },
    {
      id: 'roster:cut',
      key: 'cut' as const,
      needsSel: true,
      icon: <Scissors size="1em" />,
      label: ({ count }: { count: number }) => `Cut (${count})`,
      title: 'Cut selected resonators (Ctrl/Cmd+X)',
      run: async ({ ids }: { ids: string[] }) => {
        await ops.cut(ids)
      },
    },
    {
      id: 'roster:delete',
      key: 'delete' as const,
      needsSel: true,
      icon: <Trash2 size="1em" />,
      danger: true,
      label: ({ count }: { count: number }) => `Delete (${count})`,
      title: 'Delete selected resonators (Delete)',
      run: ({ ids }: { ids: string[] }) => {
        ops.remove(ids)
      },
    },
    {
      id: 'roster:paste',
      key: 'paste' as const,
      float: false,
      label: 'Paste',
      run: () => {
        void ops.paste()
      },
    },
  ], [ops])

  const selection = useSel({
    surfaceId: 'roster',
    ariaLabel: 'Roster selection actions',
    items: selectionItems,
    acts: selectionActions,
  })

  const getItems = useCallback((resonatorId: string) => {
    if (!ops.rosterById.has(resonatorId)) return []
    if (selection.selectionMode) return selection.contextItemsFor(resonatorId)
    const selectionIds = [resonatorId]

    return getEvaluationTargetCtx({
      id: resonatorId,
      isActive: contextResId === resonatorId,
      isSelectionPicked: selection.isSelected(resonatorId),
      onSwitch: () => selectContextResonator(resonatorId),
      onDelete: () => ops.remove(selectionIds),
      onCut: () => { void ops.cut(selectionIds) },
      onCopy: () => { void ops.copy(selectionIds) },
      onPaste: () => { void ops.paste() },
      onSelect: () => {
        selection.focusSurface()
        selection.toggleSelection(resonatorId)
      },
    })
  }, [contextResId, ops, selectContextResonator, selection])

  const backgroundItems = useMemo(() => selection.selectionMode ? selection.contextItemsFor() : [
    {
      id: 'roster:add',
      label: 'Add resonator',
      icon: <UserRoundPlus size="1em" />,
      onSelect: rosterAdd.open,
    },
    {
      id: 'roster:paste',
      label: 'Paste',
      icon: <Clipboard size="1em" />,
      onSelect: () => { void ops.paste() },
    },
    { type: 'separator' as const },
    {
      id: 'roster:delete-all',
      label: 'Delete all context resonators',
      icon: <Trash2 size="1em" />,
      danger: true,
      disabled: roster.length === 0,
      onSelect: () => ops.remove(roster.map((entry) => entry.id), {
        title: 'Remove all context resonators?',
        message: 'This will remove every scenario represented by the context roster. Build Lab will create a default fallback scenario.',
        successMessage: `Removed ${roster.length} context resonators from Build Lab.`,
      }),
    },
  ], [ops, roster, rosterAdd.open, selection])

  return (
    <>
      <List
        roster={roster}
        groups={groups}
        contextResId={contextResId}
        view={view}
        mates={mates}
        onOpenMember={openMember}
        onRemove={ops.removeByDrag}
        confirmRemoval={!ops.canUndoRemoval}
        onContextChange={selectContextResonator}
        onAddResonator={rosterAdd.open}
        backgroundItems={backgroundItems}
        selection={{
          selectionMode: selection.selectionMode,
          isSelected: selection.isSelected,
          buildClickCapture: selection.buildClickCapture,
          getItems,
          surfaceProps: selection.surfaceProps,
        }}
      />
      {rosterAdd.portal}
      <ConfirmHost control={confirmation} portalTarget={mainPortal()} />
    </>
  )
}
