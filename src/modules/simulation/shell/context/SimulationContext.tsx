/*
  Author: Runor Ewhro
  description: provides canonical simulation workspace state and mutations to nested surfaces.
*/

import { DisplayImage } from '@/shared/ui/DisplayImage'
import { createContext as mkCtx, useCallback, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import type { SkillTabKey } from '@/domain/entities/resonator.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { useAppStore } from '@/application/state'
import { seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { RES_MENU, getResDtls } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { ResPckr } from '@/modules/simulation/features/resonator/Picker.tsx'
import { useSkllData } from '@/modules/simulation/features/resonator/SkillDataHost.tsx'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { useResQStr } from '@/shared/util/resonatorQueueStore.ts'
import { skillTab } from '@/modules/simulation/shell/context/skillData.ts'
import type { FeatureResult } from '@/domain/gameData/contracts.ts'
import { SquareArrowUpRight as SqrRrwUpRght } from 'lucide-react'
import { useRtChrmMen } from '@/application/context-menu/routeMenuContext'
import { simulationMenuBuilder } from '@/modules/simulation/shell/context-menu/simulationContextBuilders.tsx'
import { withDefResMg } from '@/shared/lib/imageFallback.ts'

interface SkllDataTgt {
  resonatorId: string
  tab: SkillTabKey
}

interface SimulationContextValue {
  openResPckr: () => void
  openSkllData: (target: SkllDataTgt) => void
  getSkillData: (entry: Pick<FeatureResult, 'resonatorId' | 'skill'>) => SkllDataTgt | null
  builders: {
    simulation: {
      workspace: () => MenuEntry[]
      more: () => MenuEntry[]
      damage: {
        row: (args: {
          rowId: string
          subHitsVis: boolean
          hasSubHitReq: boolean
          onTgglFrml: () => void
          onTgglSubHwm: () => void
          onOpenSklleu?: () => void
        }) => MenuEntry[]
      }
      rotation: {
        pane: (args: { items: MenuEntry[] }) => MenuEntry[]
        item: (args: { items: MenuEntry[] }) => MenuEntry[]
      }
      optimizer: {
        pane: (args: { items: MenuEntry[] }) => MenuEntry[]
      }
      manualBuffs: {
        pane: (args: {
          canSelectAny: boolean
          selMode: boolean
          onPaste: () => void
          onSelectAll: () => void
          onDeselectAll: () => void
        }) => MenuEntry[]
        item: (args: {
          modifierId: string
          onCopy: () => void
          onCut: () => void
          onPaste: () => void
          onDuplicate: () => void
          onDelete: () => void
          onSelect: () => void
        }) => MenuEntry[]
      }
      echo: {
        pane: (args: {
          curBldSvd: boolean
          canSaveAll: boolean
          canNqpAll: boolean
          canSelectAny: boolean
          selMode: boolean
          onOpenInv: () => void
          onImportEcho: () => void
          onSaveBuild: () => void
          onSaveAll: () => void
          onUnequipAll: () => void
          onPaste: () => void
          onSelectAll: () => void
          onDeselectAll: () => void
        }) => MenuEntry[]
        emptySlot: (args: {
          slotIndex: number
          canSelectAny: boolean
          selMode: boolean
          onSelectEcho: () => void
          onOpenInv: () => void
          onPaste: () => void
          onSelectAll: () => void
          onDeselectAll: () => void
        }) => MenuEntry[]
        slot: (args: {
          slotIndex: number
          canSave: boolean
          descVisible: boolean
          onSave: () => void
          onRemove: () => void
          onEdit: () => void
          onChange: () => void
          onCopy: () => void
          onCut: () => void
          onPaste: () => void
          onSelect: () => void
          onFindInInv?: () => void
          onToggleDesc?: () => void
        }) => MenuEntry[]
        invCard: (args: {
          entryId: string
          equipEntries: MenuEntry[]
          previewNode?: ReactNode
          onEdit: () => void
          onRemove: () => void
          onCopy: () => void
          onCut: () => void
          onPaste: () => void
          onSelect: () => void
        }) => MenuEntry[]
        invBld: (args: {
          entryId: string
          onEquip: () => void
          onRename: () => void
          onRemove: () => void
        }) => MenuEntry[]
        readOnly: (args: {
          id: string
          canSave: boolean
          equipEntries: MenuEntry[]
          onSave: () => void
          onCopy: () => void
          onSelect: () => void
        }) => MenuEntry[]
      }
    }
    routeChrome: ReturnType<typeof useRtChrmMen>['builders']['routeChrome']
  }
}

interface SimulationProviderProps {
  children: ReactNode
  actResId: string | null
}

const simulationContext = mkCtx<SimulationContextValue | null>(null)

export function SimulationProvider({
  children,
  actResId: actResId,
}: SimulationProviderProps) {
  const showSubHits = useAppStore((state) => state.ui.showSubHits)
  const setShowSubHi = useAppStore((state) => state.setSubHits)
  const swtcToRes = useAppStore((state) => state.swRes)
  const rtChrmMenu = useRtChrmMen()
  const queue = useResQStr((state) => state.queue)
  const picker = useAppModal()

  // points it at a target.
  const skillData = useSkllData()

  const openResPckr = useCallback(() => {
    picker.show()
  }, [picker])

  const getSkllDataT = useCallback((entry: Pick<FeatureResult, 'resonatorId' | 'skill'>): SkllDataTgt | null => {
    const details = getResDtls(entry.resonatorId)
    const tab = skillTab(entry, details)
    return tab ? { resonatorId: entry.resonatorId, tab } : null
  }, [])

  const curResName = actResId ? seedRsntById[actResId]?.name ?? actResId : 'None'
  const swtcToEnts = useMemo<MenuEntry[]>(() => {

    const queueEntries = queue.map((entry) => ({
      id: `workspace-switch:${entry.id}`,
      label: entry.name,
      art: seedRsntById[entry.id]?.sprite || seedRsntById[entry.id]?.profile,
      icon: <span style={{ width: '16px', height: '16px' }} className="rotation-node-member-icon" title={seedRsntById[entry.id]?.name}>
              <DisplayImage src={seedRsntById[entry.id]?.profile} alt="" onError={withDefResMg} />
            </span>,
      onSelect: () => swtcToRes(entry.id),
    }))

    return [
      ...queueEntries,
      {
        id: 'main-switch:picker',
        label: 'See all resonators',
        icon: <SqrRrwUpRght size="1em" />,
        onSelect: openResPckr,
      },
    ]
  }, [openResPckr, queue, swtcToRes])


  const simulationMoreEntries = useMemo(() => simulationMenuBuilder.simulation.more({
    swtcToNtrs: swtcToEnts,
    showSubHits,
    onToggleSubHits: () => setShowSubHi(!showSubHits),
  }), [setShowSubHi, showSubHits, swtcToEnts])

  const builders = useMemo<SimulationContextValue['builders']>(() => ({
    simulation: {
      workspace: () => simulationMenuBuilder.simulation.workspace({
        swtcToNtrs: swtcToEnts,
        showSubHits,
        onToggleSubHits: () => setShowSubHi(!showSubHits),
      }),
      more: () => simulationMoreEntries,
      damage: {
        row: ({ rowId, subHitsVis: subHitsVis, hasSubHitReq: hasSubHitRow, onTgglFrml: onTgglFrml, onTgglSubHwm: onTgglSubHit, onOpenSklleu: onOpenSkllDa }) =>
          simulationMenuBuilder.simulation.damage.row({
            rowId,
            subHitsVis: subHitsVis,
            hasSubHitReq: hasSubHitRow,
            onTgglFrml: onTgglFrml,
            onTgglSubHwm: onTgglSubHit,
            onOpenSklleu: onOpenSkllDa,
            moreEntries: [],
          }),
      },
      rotation: {
        pane: ({ items }) => simulationMenuBuilder.simulation.rotation.pane({
          items,
          moreEntries: [],
        }),
        item: ({ items }) => simulationMenuBuilder.simulation.rotation.item({
          items,
          moreEntries: [],
        }),
      },
      optimizer: {
        pane: ({ items }) => simulationMenuBuilder.simulation.optimizer.main({
          items,
          moreEntries: [],
        }),
      },
      manualBuffs: {
        pane: (args) => simulationMenuBuilder.simulation.manualBuffs.pane({
          ...args,
          moreEntries: [],
        }),
        item: (args) => simulationMenuBuilder.simulation.manualBuffs.item({
          ...args,
          moreEntries: [],
        }),
      },
      echo: {
        pane: (args) => simulationMenuBuilder.simulation.echo.pane(args),
        emptySlot: (args) => simulationMenuBuilder.simulation.echo.emptySlot(args),
        slot: (args) => simulationMenuBuilder.simulation.echo.slot(args),
        invCard: (args) => simulationMenuBuilder.simulation.echo.invCard(args),
        invBld: (args) => simulationMenuBuilder.simulation.echo.invMk(args),
        readOnly: (args) => simulationMenuBuilder.simulation.echo.readOnly(args),
      },
    },
    routeChrome: rtChrmMenu.builders.routeChrome,
  }), [
    simulationMoreEntries,
    rtChrmMenu.builders.routeChrome,
    setShowSubHi,
    swtcToEnts,
    showSubHits,
  ])

  const value = useMemo<SimulationContextValue>(() => ({
    openResPckr: openResPckr,
    openSkllData: skillData.open,
    getSkillData: getSkllDataT,
    builders,
  }), [builders, getSkllDataT, openResPckr, skillData.open])

  return (
    <simulationContext.Provider value={value}>
      {children}
      <ResPckr
        visible={picker.visible}
        open={picker.open}
        closing={picker.closing}
        portalTarget={mainPortal()}
        eyebrow="Roster"
        title="Select Resonator"
        resonators={RES_MENU}
        selResId={actResId}
        selLbl="Active"
        smmrPrmr={{
          label: 'Current',
          value: curResName,
        }}
        emptyState={<p>I hope Solon Lee releases the character you're searching for.</p>}
        closeLabel="Close"
        panelWidth="regular"
        onClose={picker.hide}
        onSelect={(resonatorId) => {
          swtcToRes(resonatorId)
          picker.hide()
        }}
      />
    </simulationContext.Provider>
  )
}

export function useOptionalSimulationContext(): SimulationContextValue | null {
  return useContext(simulationContext)
}
