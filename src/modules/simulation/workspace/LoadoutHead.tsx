/*
  Author: Runor Ewhro
  description: coordinates loadout summary, bulk actions, and inventory or parser entry points.
*/

import { isBuildSaved, selectSavedBuildSignatures } from '@/application/state/savedGearStatus'

import { useCallback, useMemo, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'
import {
  cloneEchoLoadout,
  saveEchoSlots,
} from '@/domain/entities/inventoryStorage.ts'
import { useAppStore } from '@/application/state'
import { cmptTtlEchoC, MAX_ECHO_COST } from '@/modules/simulation/features/echoes/lib/echoes.ts'
import { QuickSetup } from '@/modules/simulation/features/echoes/QuickSetup.tsx'
import { openEchoImport } from '@/modules/simulation/features/echoes/lib/echoImportStore.ts'
import { openTeamCnsl } from '@/modules/simulation/features/teams/lib/teamConsoleStore.ts'
import { ConfirmHost } from '@/shared/ui/ConfirmationModal.tsx'
import { useConfirm } from '@/shared/hooks/useConfirmation.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { AnchoredAppPopup, useAppPopup, useAppPopupDismiss } from '@/shared/ui/AppPopup.tsx'
import { LoadoutEffects, hasLoadoutEffects } from '@/modules/simulation/workspace/LoadoutEffects.tsx'

interface HeadTool {
  key: string
  label: string
  title: string
  disabled?: boolean
  danger?: boolean
  go?: boolean
  onSelect: () => void
}

export function LoadoutHead({
  title = 'Echo Loadout',
  runtime,
  scenarioId,
  resonatorName,
  echoes,
  proposal = false,
  editable = true,
  canSaveEcho,
  onEchoes,
  onGenerateLoadout,
  onEquip,
  aside,
  headRef,
}: {
  /* surfaces that keep a disposable workspace name it themselves */
  title?: string
  runtime: ResRuntime | null
  scenarioId?: CombatScenarioId | null
  resonatorName?: string | null
  /* the loadout on show: what is equipped, or what a surface is proposing */
  echoes: Array<EchoInstance | null>
  proposal?: boolean
  editable?: boolean
  canSaveEcho: (echo: EchoInstance) => boolean
  onEchoes?: (echoes: Array<EchoInstance | null>) => void
  /* a surface can provide its own loadout generator action. */
  onGenerateLoadout?: () => void
  /* a proposal cannot be taken off, only put on */
  onEquip?: () => void
  aside?: ReactNode
  headRef?: RefObject<HTMLElement | null>
}) {
  const showToast = useTstStr((state) => state.show)
  const savedBuilds = useAppStore(selectSavedBuildSignatures)
  const addBuildToInv = useAppStore((state) => state.addInvBuild)
  const addEchoesToInv = useAppStore((state) => state.addInvEchoes)
  const confirmation = useConfirm()
  const generatorModal = useAppModal()
  const effects = useAppPopup()
  const effectsTriggerRef = useRef<HTMLButtonElement>(null)
  const effectsRef = useRef<HTMLDivElement>(null)
  const canReadEffects = hasLoadoutEffects(echoes)
  useAppPopupDismiss({
    open: effects.visible,
    onDismiss: effects.hide,
    hostRef: effectsTriggerRef,
    popupRef: effectsRef,
    returnFocusRef: effectsTriggerRef,
  })

  const cost = useMemo(() => cmptTtlEchoC(echoes), [echoes])
  const over = cost > MAX_ECHO_COST
  const filled = echoes.filter(Boolean).length

  const savableSlots = useMemo(() => echoes.reduce<number[]>((slots, echo, index) => {
    if (echo && canSaveEcho(echo)) slots.push(index)
    return slots
  }, []), [canSaveEcho, echoes])

  // a build is only "saved" while the bag contains this exact weapon and loadout
  const alreadySaved = useMemo(() => {
    if (!runtime) return false
    return isBuildSaved(savedBuilds, {
      weapon: runtime.build.weapon,
      echoes,
    })
  }, [echoes, runtime, savedBuilds])

  const onSaveBuild = useCallback(() => {
    if (!runtime || alreadySaved) return

    const saved = addBuildToInv({
      resonatorId: runtime.id,
      resonatorName: resonatorName ?? runtime.id,
      build: {
        weapon: { ...runtime.build.weapon },
        echoes: cloneEchoLoadout(echoes),
      },
    })

    showToast({
      content: saved
        ? (proposal ? 'Result saved to your builds.' : 'Build saved.')
        : 'This build is already saved.',
      variant: saved ? 'success' : 'warning',
      duration: 2600,
    })
  }, [addBuildToInv, alreadySaved, echoes, proposal, resonatorName, runtime, showToast])

  const onSaveAll = useCallback(() => {
    if (savableSlots.length === 0) return
    const { savedCount, nextEchoes } = saveEchoSlots(echoes, savableSlots, addEchoesToInv)
    if (nextEchoes) onEchoes?.(nextEchoes)

    showToast({
      content: `Saved ${savedCount} echo${savedCount === 1 ? '' : 'es'} to bag.`,
      variant: 'success',
      duration: 2600,
    })
  }, [addEchoesToInv, echoes, onEchoes, savableSlots, showToast])

  const onUnequipAll = useCallback(() => {
    confirmation.confirm({
      title: 'Take them all off?',
      message: 'Every echo comes out of this loadout. Saved echoes stay in your bag.',
      confirmLabel: 'Unequip all',
      variant: 'danger',
      onConfirm: () => onEchoes?.([null, null, null, null, null]),
    })
  }, [confirmation, onEchoes])

  const tools: HeadTool[] = [
    {
      key: 'import',
      label: 'Import',
      title: 'Import echoes from a build card screenshot',
      disabled: !runtime,
      onSelect: () => { if (runtime) openEchoImport(runtime.id) },
    },
    {
      key: 'config',
      label: 'Config',
      title: 'Configure this resonator and team',
      disabled: !runtime,
      onSelect: () => { if (runtime) openTeamCnsl(runtime.id, 'loadout', scenarioId) },
    },
    {
      key: 'generate',
      label: 'Generate',
      title: 'Build a loadout from your bag',
      disabled: !editable || !runtime,
      onSelect: onGenerateLoadout ?? generatorModal.show,
    },
    {
      key: 'save',
      label: alreadySaved ? 'Saved' : 'Save build',
      title: proposal ? 'Keep this result without equipping it' : 'Save this build',
      disabled: !runtime || alreadySaved,
      onSelect: onSaveBuild,
    },
    {
      key: 'save-all',
      label: 'Save all',
      title: savableSlots.length === 0
        ? 'Every echo here is already in your bag'
        : `Save ${savableSlots.length} echo${savableSlots.length === 1 ? '' : 'es'} to your bag`,
      disabled: !editable || savableSlots.length === 0,
      onSelect: onSaveAll,
    },
    proposal
      ? {
        key: 'equip',
        label: 'Equip',
        title: 'Equip this build',
        disabled: !onEquip,
        go: true,
        onSelect: () => onEquip?.(),
      }
      : {
        key: 'unequip',
        label: 'Unequip',
        title: 'Take every echo out of this loadout',
        disabled: !editable || filled === 0,
        danger: true,
        onSelect: onUnequipAll,
      },
  ]

  return (
    <header className="lho" ref={headRef}>
      <div className="lho-line">
        <h3 className="lho-title">
          {canReadEffects ? (
            <button
              ref={effectsTriggerRef}
              type="button"
              className="lho-title-link"
              aria-haspopup="dialog"
              aria-expanded={effects.visible}
              title="Show echo skill and Sonata effects"
              onClick={effects.toggle}
            >
              {title}
            </button>
          ) : title}
        </h3>
        <span className="lho-read"
          data-over={over ? 'true' : undefined}
          title={over ? `${cost} cost, ${cost - MAX_ECHO_COST} over the cap` : `${cost} of ${MAX_ECHO_COST} cost spent`}
        >
          cost {cost}/{MAX_ECHO_COST}
        </span>

        {aside}

        <div className="lho-tools" role="group" aria-label="Echo build actions">
          {tools.map((tool, index) => (
            <span key={tool.key} className="lho-tool-slot">
              {index > 0 ? <span className="lho-sep" aria-hidden="true" /> : null}
              <button
                type="button"
                className={[
                  'lho-tool',
                  tool.danger ? 'lho-tool--danger' : '',
                  tool.go ? 'lho-tool--go' : '',
                ].filter(Boolean).join(' ')}
                title={tool.title}
                disabled={tool.disabled}
                onClick={tool.onSelect}
              >
                {tool.label}
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="lho-rule">
        <span className="lho-seg lho-seg--lead" aria-hidden="true" />
        <b className="lho-word" data-proposed={proposal ? 'true' : undefined}>
          {proposal ? 'Proposed' : 'Equipped'}
        </b>
        <span className="lho-seg lho-seg--rest" aria-hidden="true" />
      </div>

      {!onGenerateLoadout && generatorModal.visible && runtime ? (
        <QuickSetup
          visible={generatorModal.visible}
          open={generatorModal.open}
          closing={generatorModal.closing}
          portalTarget={mainPortal()}
          currentEchoes={echoes}
          onClose={generatorModal.hide}
          onGenerate={(next) => {
            onEchoes?.(next)
            showToast({
              content: 'Echo loadout generated.',
              variant: 'success',
              duration: 2600,
            })
            generatorModal.hide()
          }}
        />
      ) : null}

      {canReadEffects ? (
        <AnchoredAppPopup
          visible={effects.visible}
          open={effects.open}
          closing={effects.closing}
          anchorRef={effectsTriggerRef}
          popupRef={effectsRef}
          preferredPlacement="down"
          maxHeight={560}
          offset={10}
          className="lho-fx"
          role="dialog"
          aria-label="Echo skill and Sonata effects"
        >
          <LoadoutEffects echoes={echoes} />
        </AnchoredAppPopup>
      ) : null}

      <ConfirmHost control={confirmation} portalTarget={mainPortal()} />
    </header>
  )
}
