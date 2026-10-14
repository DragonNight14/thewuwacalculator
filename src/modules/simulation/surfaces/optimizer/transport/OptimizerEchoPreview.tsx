/*
  Author: Runor Ewhro
  description: provides an editable echo preview for optimizer results; changes remain local until saved or equipped.
*/

import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import AppLoaderOverlay from '@/shared/ui/AppLoaderOverlay'
import { Copy, FileImage, Scissors, Trash2 } from 'lucide-react'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import { cloneEchoLoadout, sameEchoUid, equalEchoes } from '@/domain/entities/inventoryStorage.ts'
import { getEchoById, listEchoes } from '@/data/catalog/echoCatalogService.ts'
import { useAppStore } from '@/application/state'
import { useEchoScores } from '@/application/hooks/useEchoScoringRevision.ts'
import { EchoCard } from '@/modules/simulation/workspace/ui.tsx'
import { LoadoutHead } from '@/modules/simulation/workspace/LoadoutHead.tsx'
import { MAX_ECHO_COST } from '@/modules/simulation/features/echoes/lib/echoes.ts'
import type { EvaluationEchoSelection } from '@/modules/simulation/workspace/ui.tsx'
import { makeEchoSlot } from '@/modules/simulation/workspace/echoSlot.ts'
import { useWorkspaceEchoActions } from '@/modules/simulation/workspace/useWorkspaceEchoActions.ts'



import { mkDefEchoNst } from '@/modules/simulation/features/echoes/lib/echoPane.ts'
import { cmptTtlEchoC } from '@/modules/simulation/features/echoes/lib/echoes.ts'
import { getEchoMptyC, getEchoSlotC } from '@/modules/simulation/features/echoes/lib/ctx.tsx'
import { pasteEchoes, readEchoClip } from '@/modules/simulation/features/echoes/lib/clipboard.ts'
import { qpEchoAtSlot } from '@/modules/simulation/features/echoes/lib/equip.ts'
import { useEchoSrfcM } from '@/modules/simulation/features/echoes/lib/useEchoSurfaceMenu.tsx'
import { useSel } from '@/modules/simulation/lib/sel.tsx'
import { useCtxBuilder } from '@/modules/simulation/shell/context-menu/useContextMenuBuilder.ts'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import { useAppModal, useAppModalValue } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'

/** manages the generator modal for the optimizer preview; generated echoes update the detached loadout. */
export function usePreviewGenerator({
  echoes,
  onGenerate,
}: {
  echoes: Array<EchoInstance | null>
  onGenerate: (echoes: Array<EchoInstance | null>) => void
}) {
  const generator = useAppModal()
  const showToast = useTstStr((state) => state.show)
  const openGenerator = useCallback(() => generator.show(), [generator])
  const portal = generator.visible ? (
    <Suspense fallback={<AppLoaderOverlay mode="scrim" text="Loading loadout generator..." />}><QuickSetup
      visible={generator.visible}
      open={generator.open}
      closing={generator.closing}
      portalTarget={mainPortal()}
      currentEchoes={echoes}
      onClose={generator.hide}
      onGenerate={(generated) => {
        onGenerate(cloneEchoLoadout(generated))
        showToast({
          content: 'Preview loadout generated',
          variant: 'success',
          duration: 3000,
        })
        generator.hide()
      }}
    /></Suspense>
  ) : null

  return { openGenerator, portal }
}

function previewSlotId(slotIndex: number): string {
  return `optimizer-preview:${slotIndex}`
}

function slotFromPreviewId(id: string): number | null {
  const value = Number.parseInt(id.slice(id.lastIndexOf(':') + 1), 10)
  return Number.isInteger(value) && value >= 0 && value < 5 ? value : null
}

export function OptimizerEchoPreview({
  resonatorId,
  resonatorName,
  runtime,
  previewKey,
  sourceEchoes,
  editable,
  onEquip,
}: {
  resonatorId: string
  resonatorName: string
  runtime: ResRuntime
  /* which loadout the workspace is seeded from: a result row, or the build */
  previewKey: string
  sourceEchoes: Array<EchoInstance | null>
  editable: boolean
  onEquip: (echoes: Array<EchoInstance | null>) => void
}) {
  const [echoes, setEchoes] = useState<Array<EchoInstance | null>>(
    () => sourceEchoes.slice(),
  )
  // picking another row seeds the same five workspace slots. swap the seed
  // during render to preserve selection, menus, modals, and card animation state.
  const [seed, setSeed] = useState({ key: previewKey, echoes: sourceEchoes })
  if (seed.key !== previewKey || (seed.echoes !== sourceEchoes && sourceEchoes.some((echo, index) => {
    const previous = seed.echoes[index]
    return echo !== previous && (!echo || !previous || echo.uid !== previous.uid || echo.mainEcho !== previous.mainEcho || !equalEchoes(echo, previous))
  }))) {
    setSeed({ key: previewKey, echoes: sourceEchoes })
    setEchoes(sourceEchoes.slice())
  }
  const showToast = useTstStr((state) => state.show)
  const updateRuntime = useAppStore((state) => state.updResRt)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const setInventorySearch = useAppStore((state) => state.setInvEchoQ)
  const menu = useCtxBuilder()
  const openInventory = menu.routeChrome.actions.openInv
  const picker = useAppModalValue<number>()
  const editor = useAppModalValue<number>()
  const allEchoes = useMemo(() => listEchoes(), [])
  const { openGenerator, portal: generatorPortal } = usePreviewGenerator({
    echoes,
    onGenerate: setEchoes,
  })

  const echoSurface = useEchoSrfcM({
    clpbSrcResId: resonatorId,
    clipSourceName: resonatorName,
    currentEchoes: runtime.build.echoes,
    onQpEchoAtjg: (echo, slotIndex) => {
      updateRuntime(resonatorId, (current) => ({
        ...current,
        build: {
          ...current.build,
          echoes: qpEchoAtSlot(current.build.echoes, echo, slotIndex),
        },
      }))
    },
  })

  const removeSlots = useCallback((slotIndexes: readonly number[]) => {
    if (!editable || slotIndexes.length === 0) return
    setEchoes((current) => {
      const next = [...current]
      for (const slotIndex of slotIndexes) next[slotIndex] = null
      return next
    })
  }, [editable])

  const pasteAt = useCallback(async (slotIndex: number) => {
    if (!editable) return
    const payload = await readEchoClip()
    if (!payload) {
      showToast({
        content: 'Clipboard does not contain an echo.',
        variant: 'warning',
        duration: 3200,
      })
      return
    }

    const result = pasteEchoes(echoes, payload, slotIndex)
    if (result.pastedCount > 0) setEchoes(result.nextEchoes)
    showToast({
      content: result.pastedCount === 0
        ? 'Nothing valid to paste here.'
        : result.skippedCount > 0
          ? `Pasted ${result.pastedCount} echo${result.pastedCount === 1 ? '' : 'es'} (${result.skippedCount} skipped).`
          : `Pasted ${result.pastedCount} echo${result.pastedCount === 1 ? '' : 'es'}.`,
      variant: result.pastedCount === 0 ? 'warning' : 'success',
      duration: result.pastedCount === 0 ? 3200 : 2400,
    })
  }, [echoes, editable, showToast])

  const selectionItems = useMemo(() => echoes.flatMap((echo, slotIndex) => (
    echo ? [{ id: previewSlotId(slotIndex), val: echo }] : []
  )), [echoes])

  const selection = useSel({
    active: editable,
    surfaceId: 'optimizer-preview',
    ariaLabel: 'Optimizer preview Echo actions',
    noun: { one: 'echo', many: 'echoes' },
    items: selectionItems,
    acts: [
      {
        id: 'optimizer-preview:copy',
        key: 'copy',
        needsSel: true,
        icon: <Copy size="1em" />,
        label: ({ count }) => `Copy (${count})`,
        title: 'Copy selected Echoes (Ctrl/Cmd+C)',
        run: async ({ vals }) => {
          const wrote = await echoSurface.copyEchoesToClipboard(vals)
          if (wrote) {
            showToast({
              content: `Copied ${vals.length} echo${vals.length === 1 ? '' : 'es'}.`,
              variant: 'success',
              duration: 2200,
            })
          }
        },
      },
      {
        id: 'optimizer-preview:cut',
        key: 'cut',
        needsSel: true,
        icon: <Scissors size="1em" />,
        label: ({ count }) => `Cut (${count})`,
        title: 'Cut selected Echoes (Ctrl/Cmd+X)',
        run: async ({ ids, vals }) => {
          const wrote = await echoSurface.copyEchoesToClipboard(vals)
          if (!wrote) return
          removeSlots(ids.flatMap((id) => {
            const slot = slotFromPreviewId(id)
            return slot == null ? [] : [slot]
          }))
          showToast({
            content: `Cut ${vals.length} echo${vals.length === 1 ? '' : 'es'}.`,
            variant: 'success',
            duration: 2200,
          })
        },
      },
      {
        id: 'optimizer-preview:paste',
        key: 'paste',
        icon: <FileImage size="1em" />,
        label: 'Paste',
        title: 'Paste Echoes (Ctrl/Cmd+V)',
        float: false,
        run: async ({ ids }) => {
          const selectedSlot = ids.flatMap((id) => {
            const slot = slotFromPreviewId(id)
            return slot == null ? [] : [slot]
          })[0]
          const firstEmpty = echoes.findIndex((echo) => echo == null)
          await pasteAt(selectedSlot ?? (firstEmpty >= 0 ? firstEmpty : 0))
        },
      },
      {
        id: 'optimizer-preview:remove',
        key: 'delete',
        needsSel: true,
        danger: true,
        icon: <Trash2 size="1em" />,
        label: ({ count }) => `Remove (${count})`,
        title: 'Remove selected Echoes (Delete / Backspace)',
        run: ({ ids }) => removeSlots(ids.flatMap((id) => {
          const slot = slotFromPreviewId(id)
          return slot == null ? [] : [slot]
        })),
      },
    ],
  })

  const actions = useWorkspaceEchoActions({
    resonatorId,
    echoLoadout: echoes,
    editable,
    canSaveEcho: echoSurface.canSaveEcho,
    onEchoLoadoutChange: setEchoes,
  })

  const totalCost = useMemo(() => cmptTtlEchoC(echoes), [echoes])
  const pickerSlot = picker.value
  const editSlot = editor.value
  const pickerEcho = pickerSlot == null ? null : echoes[pickerSlot] ?? null
  const editEcho = editSlot == null ? null : echoes[editSlot] ?? null
  const pickerSlotCost = pickerEcho ? getEchoById(pickerEcho.id)?.cost ?? 0 : 0
  const editSlotCost = editEcho ? getEchoById(editEcho.id)?.cost ?? 0 : 0
  const echoScores = useEchoScores(resonatorId, echoes)
  const loadoutSlots = useMemo(
    () => echoes.map((echo) => (echo ? makeEchoSlot(echo) : null)),
    [echoes],
  )
  const loadoutCount = loadoutSlots.filter(Boolean).length

  const copySlot = useCallback(async (slotIndex: number) => {
    const echo = echoes[slotIndex]
    if (!echo) return
    const wrote = await echoSurface.copyEchoesToClipboard([echo])
    if (wrote) {
      showToast({ content: 'Copied 1 echo.', variant: 'success', duration: 2200 })
    }
  }, [echoSurface, echoes, showToast])

  const cutSlot = useCallback(async (slotIndex: number) => {
    const echo = echoes[slotIndex]
    if (!echo) return
    const wrote = await echoSurface.copyEchoesToClipboard([echo])
    if (!wrote) return
    removeSlots([slotIndex])
    showToast({ content: 'Cut 1 echo.', variant: 'success', duration: 2200 })
  }, [echoSurface, echoes, removeSlots, showToast])

  const slotMenu = useCallback((slotIndex: number, echo: EchoInstance): MenuEntry[] => {
    const id = previewSlotId(slotIndex)
    const equipEntry = echoSurface.buildReadOnlyMenu({
      id,
      echo,
      onSelect: () => selection.addToSelection(id),
    }).find((entry) => 'id' in entry && entry.id?.endsWith(':equip'))
    const normalEntries = getEchoSlotC({
      menu: menu.simulation.echo,
      slotIndex,
      echo,
      canSave: actions?.canSave(slotIndex) ?? false,
      descVisible: false,
      hasDesc: false,
      onSave: () => actions?.onSave(slotIndex),
      onRemove: () => removeSlots([slotIndex]),
      onEdit: () => editor.show(slotIndex),
      onChange: () => picker.show(slotIndex),
      onCopy: () => { void copySlot(slotIndex) },
      onCut: () => { void cutSlot(slotIndex) },
      onPaste: () => { void pasteAt(slotIndex) },
      onSel: () => selection.addToSelection(id),
      onFind: () => {
        setInventorySearch(echo.uid)
        openInventory()
      },
      onToggleDesc: () => {},
    })

    return equipEntry
      ? [equipEntry, { type: 'separator' }, ...normalEntries]
      : normalEntries
  }, [
    actions,
    copySlot,
    cutSlot,
    echoSurface,
    editor,
    menu.simulation.echo,
    openInventory,
    pasteAt,
    picker,
    removeSlots,
    selection,
    setInventorySearch,
  ])

  const emptySlotMenu = useCallback((slotIndex: number) => getEchoMptyC({
    menu: menu.simulation.echo,
    slotIndex,
    canSel: selectionItems.length > 0,
    mode: selection.selectionMode,
    onPick: () => picker.show(slotIndex),
    onOpenInv: openInventory,
    onPaste: () => { void pasteAt(slotIndex) },
    onAll: selection.selectAll,
    onNone: selection.deselectAll,
  }), [menu.simulation.echo, openInventory, pasteAt, picker, selection, selectionItems.length])

  const echoSelection = useMemo<EvaluationEchoSelection>(() => ({
    selectionMode: selection.selectionMode,
    isSelected: selection.isSelected,
    buildClickCapture: selection.buildClickCapture,
    getId: previewSlotId,
    getItems: (id, echo) => {
      if (selection.selectionMode) return selection.contextItemsFor(id)
      const slotIndex = slotFromPreviewId(id)
      return slotIndex == null ? [] : slotMenu(slotIndex, echo)
    },
    surfaceProps: selection.surfaceProps,
  }), [selection, slotMenu])

  const wornHere = useMemo(() => echoes.every((echo, index) => {
    const worn = runtime.build.echoes[index] ?? null
    if (!echo || !worn) return !echo && !worn
    return sameEchoUid(echo, worn) && echo.mainEcho === worn.mainEcho && equalEchoes(echo, worn)
  }), [echoes, runtime.build.echoes])

  const writeLoadout = useCallback((next: Array<EchoInstance | null>) => {
    setEchoes(next)
    if (!wornHere || !editable) return
    updateRuntime(resonatorId, (current) => ({
      ...current,
      build: { ...current.build, echoes: next },
    }))
  }, [editable, resonatorId, updateRuntime, wornHere])

  const writeSlot = useCallback((slotIndex: number, echo: EchoInstance | null) => {
    setEchoes((current) => {
      const next = [...current]
      next[slotIndex] = echo
      return next
    })
  }, [])

  return (
    <>
      <section className="wk-section wk-span wk-ink">
        {/* the workspace is never worn until it is equipped, so its head says
            proposed and offers the one write that makes it real */}
        <LoadoutHead
          title="Echo Preview"
          runtime={runtime}
          resonatorName={resonatorName}
          echoes={echoes}
          proposal={!wornHere}
          editable={editable}
          canSaveEcho={echoSurface.canSaveEcho}
          onEchoes={writeLoadout}
          onGenerateLoadout={openGenerator}
          onEquip={loadoutCount > 0 ? () => onEquip(echoes) : undefined}
        />
        <div className="wk-echoes" {...echoSelection.surfaceProps}>
          {Array.from({ length: 5 }, (_, index) => {
            const echo = echoes[index] ?? null
            const card = (
              <EchoCard
                key={index}
                echo={loadoutSlots[index] ?? null}
                sourceEcho={echo}
                index={index}
                selection={echoSelection}
                actions={actions}
                score={echoScores?.[index] ?? null}
                unpainted={Boolean(echo && (
                  !sameEchoUid(echo, runtime.build.echoes[index])
                  || echo.mainEcho !== runtime.build.echoes[index]?.mainEcho
                  || !equalEchoes(echo, runtime.build.echoes[index])
                ))}
                onOpen={editable ? () => (echo ? editor.show(index) : picker.show(index)) : undefined}
              />
            )

            return echo ? card : (
              <ContextTrigger
                key={index}
                asChild
                ariaLabel={`Echo slot ${index + 1} actions`}
                items={selection.selectionMode ? selection.contextItemsFor() : emptySlotMenu(index)}
              >
                {card}
              </ContextTrigger>
            )
          })}
        </div>
      </section>

      {pickerSlot != null ? (
        <Suspense fallback={<AppLoaderOverlay mode="scrim" text="Loading Echo picker..." />}><EchoPicker
          visible={picker.visible}
          open={picker.open}
          closing={picker.closing}
          portalTarget={mainPortal()}
          echoes={allEchoes}
          selEchoId={pickerEcho?.id ?? null}
          slotIndex={pickerSlot}
          maxCost={MAX_ECHO_COST - totalCost + pickerSlotCost}
          onSelect={(echoId) => {
            const definition = getEchoById(echoId)
            if (!definition || definition.cost > MAX_ECHO_COST - totalCost + pickerSlotCost) return
            const instance = mkDefEchoNst(echoId, pickerSlot, pickerEcho)
            if (!instance) return
            writeSlot(pickerSlot, instance)
            bumpPickerFreq({ bucket: 'echo', ids: [instance.id] })
          }}
          onClear={() => writeSlot(pickerSlot, null)}
          onClose={picker.hide}
        /></Suspense>
      ) : null}

      {editSlot != null && editEcho ? (
        <Suspense fallback={<AppLoaderOverlay mode="scrim" text="Loading Echo editor..." />}><Edit
          visible={editor.visible}
          open={editor.open}
          closing={editor.closing}
          portalTarget={mainPortal()}
          echo={editEcho}
          slotIndex={editSlot}
          echoes={allEchoes}
          maxCost={MAX_ECHO_COST - totalCost + editSlotCost}
          onSave={(updated) => {
            writeSlot(editSlot, updated)
            editor.hide()
          }}
          onClear={() => {
            writeSlot(editSlot, null)
            editor.hide()
          }}
          onClose={editor.hide}
        /></Suspense>
      ) : null}

      {generatorPortal}
    </>
  )
}

const Edit = lazy(() => import('@/modules/simulation/features/echoes/Edit.tsx').then((module) => ({ default: module.Edit })))

const EchoPicker = lazy(() => import('@/modules/simulation/features/echoes/Picker.tsx').then((module) => ({ default: module.EchoPicker })))

const QuickSetup = lazy(() => import('@/modules/simulation/features/echoes/QuickSetup.tsx').then((module) => ({ default: module.QuickSetup })))
