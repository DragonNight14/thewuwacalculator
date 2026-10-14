/*
  Author: Runor Ewhro
  description: renders showcase customization, artwork, and capture within the build workspace.
*/
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from 'react'
import { useAppStore } from '@/application/state'
import { DEF_SHOWCASE_CARD_STYLE, DEF_SHOWCASE_HIDE, type ShowcaseCardStyle } from '@/domain/entities/preferences'
import { type StoredImage } from '@/application/media/imageUpload'
import { resolveShowcaseImage, type ShowcaseImage } from '@/application/media/showcaseImage'
import { useAppModal } from '@/shared/ui/useAppModal'
import { useTstStr } from '@/shared/util/toastStore'
import { buildTextSlotVars, collectCardFontFamilies, splitHoistedCss } from '../surfaces/showcase/cardStyleVars'
import { DEFAULT_PORTRAIT_SURFACE, inkForSurface, readPortraitSurface } from '../surfaces/showcase/portraitSurface'
import type { CardExportTarget } from '../surfaces/showcase/cardTransfer'
import { ensureGoogleFamily, ensureShowcaseFonts } from '@/application/theme/typography'
import { BuildRail } from './BuildRail'
import { RailDock } from './RailDock'
import { ResolvedBackdropContext } from './showcaseArtworkContext'
import { BuildWorkspaceBoard, BuildWorkspaceRailSlot, BuildWorkspaceWorkspace } from './BuildWorkspaceLayout'
import type { CssVars } from './ui'
import { getEvaluationSpinePlacement } from '@/shared/spine/placement'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger'
import type { MenuEntry } from '@/shared/ui/CtxMenu'
import { Clipboard, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { TbCameraDown } from 'react-icons/tb'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'
const ImageUploadModal = lazy(async () => ({ default: (await import('@/application/media/ImageUploadModal')).ImageUploadModal }))
const ShowcaseCustomizePanel = lazy(async () => ({ default: (await import('../surfaces/showcase/Customize')).ShowcaseCustomizePanel }))
const ShowcaseCssEditorDock = lazy(async () => ({ default: (await import('../surfaces/showcase/CssEditorDock')).ShowcaseCssEditorDock }))
const MemoRailDock = memo(RailDock)
const EMPTY_RAIL_STYLE: CssVars = {}

type RailProps = Omit<ComponentProps<typeof BuildRail>, 'buildCardRef' | 'customCss' | 'editMode' | 'cardHidden' | 'railStyle' | 'backdropStyle' | 'statsColumn' | 'portraitCredit' | 'backdropCredit' | 'resolvedPortrait' | 'showcasePlacement' | 'autoImageContrast' | 'layout'>

function useResolvedImageRef(ref: string | null, enabled: boolean, edge: number): ShowcaseImage | null {
  const [resolved, setResolved] = useState<{ ref: string; image: ShowcaseImage } | null>(null)
  const held = useRef<ShowcaseImage | null>(null)
  useEffect(() => {
    if (!enabled || !ref) {
      held.current?.release(); held.current = null
      // eslint-disable-next-line react-hooks/set-state-in-effect -- release the resolved URL when its owner leaves.
      setResolved(null)
      return
    }
    const abort = new AbortController()
    void resolveShowcaseImage(ref, edge, abort.signal).then((image) => {
      if (!image) return
      if (abort.signal.aborted) { image.release(); return }
      held.current?.release()
      held.current = image
      setResolved({ ref, image })
    }).catch(() => {})
    return () => abort.abort()
  }, [edge, enabled, ref])
  useEffect(() => () => { held.current?.release(); held.current = null }, [])
  return enabled && ref && resolved?.ref === ref ? resolved.image : null
}

export function BuildWorkspacePresentation({ railProps, dockProps, boardRef, page, isDarkTheme, stageContextItems, onCaptureChange, children }: {
  railProps: RailProps; dockProps: ComponentProps<typeof RailDock>; boardRef: RefObject<HTMLDivElement | null>;
  page: ComponentProps<typeof BuildWorkspaceBoard>['page']; isDarkTheme: boolean;
  stageContextItems: ComponentProps<typeof ContextTrigger>['items']; onCaptureChange: (action: 'download' | 'clipboard' | null) => void; children: ReactNode
}) {
  const { isShowcase, railResId, railModel } = railProps
  const showToast = useTstStr((state) => state.show)
  const [captureAction, setCaptureAction] = useState<'download' | 'clipboard' | null>(null)
  useEffect(() => { onCaptureChange(captureAction) }, [captureAction, onCaptureChange])
  // showcase customization persists independently for each resonator.
  const patchShowcaseCardStyle = useAppStore((state) => state.patchShowcaseCardStyle)
  const toggleShowcaseHide = useAppStore((state) => state.toggleShowcaseHide)
  const patchShowcaseCardHidden = useAppStore((state) => state.patchShowcaseCardHidden)
  const resetShowcaseCard = useAppStore((state) => state.resetShowcaseCard)
  const showcaseLayout = useAppStore((state) => state.ui.preferences.showcaseLayout)
  const setShowcaseLayout = useAppStore((state) => state.setShowcaseLayout)
  const buildCardRef = useRef<HTMLElement | null>(null)
  const [sampledSurface, setSampledSurface] = useState<{
    resonatorId: string
    imageRef: string | null
    color: string
  } | null>(null)
  const cardConfig = useAppStore((state) => (
    railResId ? state.ui.preferences.showcaseCards[railResId] ?? null : null
  ))
  const persistedCardStyle = cardConfig?.style ?? DEF_SHOWCASE_CARD_STYLE
  const persistedCardStyleRef = useRef(persistedCardStyle)
  persistedCardStyleRef.current = persistedCardStyle
  const [cardStyleDraft, setCardStyleDraft] = useState<{
    resonatorId: string | null
    style: ShowcaseCardStyle
  }>(() => ({ resonatorId: railResId, style: persistedCardStyle }))
  const pendingStylePatch = useRef<{
    resonatorId: string
    patch: Partial<ShowcaseCardStyle>
  } | null>(null)
  const styleCommitTimer = useRef<number | null>(null)
  const previewPatch = useRef<Partial<ShowcaseCardStyle>>({})
  const previewFrame = useRef<number | null>(null)
  const flushPreview = useCallback(() => {
    if (previewFrame.current != null) cancelAnimationFrame(previewFrame.current)
    previewFrame.current = null
    const patch = previewPatch.current
    previewPatch.current = {}
    if (!Object.keys(patch).length) return
    setCardStyleDraft((current) => ({ resonatorId: railResId, style: {
      ...(current.resonatorId === railResId ? current.style : persistedCardStyleRef.current), ...patch,
    } }))
  }, [railResId])
  const flushPreviewRef = useRef(flushPreview)
  flushPreviewRef.current = flushPreview
  const flushShowcaseStyle = useCallback(() => {
    flushPreviewRef.current()
    if (styleCommitTimer.current != null) window.clearTimeout(styleCommitTimer.current)
    styleCommitTimer.current = null
    const pending = pendingStylePatch.current
    pendingStylePatch.current = null
    if (pending) patchShowcaseCardStyle(pending.resonatorId, pending.patch)
  }, [patchShowcaseCardStyle])
  const discardPendingShowcaseStyle = useCallback(() => {
    if (styleCommitTimer.current != null) window.clearTimeout(styleCommitTimer.current)
    if (previewFrame.current != null) cancelAnimationFrame(previewFrame.current)
    previewFrame.current = null
    previewPatch.current = {}
    styleCommitTimer.current = null
    pendingStylePatch.current = null
  }, [])
  const updateShowcaseStyle = useCallback((patch: Partial<ShowcaseCardStyle>) => {
    if (!railResId) return
    const pending = pendingStylePatch.current
    if (pending && pending.resonatorId !== railResId) flushShowcaseStyle()
    if (!pendingStylePatch.current) pendingStylePatch.current = { resonatorId: railResId, patch: {} }
    Object.assign(pendingStylePatch.current.patch, patch)
    Object.assign(previewPatch.current, patch)
    if (previewFrame.current == null) previewFrame.current = requestAnimationFrame(flushPreview)
    if (styleCommitTimer.current != null) window.clearTimeout(styleCommitTimer.current)
    styleCommitTimer.current = window.setTimeout(flushShowcaseStyle, 320)
  }, [flushPreview, flushShowcaseStyle, railResId])
  useEffect(() => {
    const flush = () => flushShowcaseStyle()
    const hidden = () => { if (document.hidden) flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', hidden)
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hidden) }
  }, [flushShowcaseStyle])
  useEffect(() => { if (!isShowcase) flushShowcaseStyle() }, [flushShowcaseStyle, isShowcase])
  const cardStyle = cardStyleDraft.resonatorId === railResId
    ? cardStyleDraft.style
    : persistedCardStyle
  const cardHidden = cardConfig?.hidden ?? DEF_SHOWCASE_HIDE
  const [tuneResetKey, setTuneResetKey] = useState(0)
  const [editMode, setEditMode] = useState<'portrait' | 'backdrop' | null>(null)

  useEffect(() => {
    flushShowcaseStyle()
    setCardStyleDraft({ resonatorId: railResId, style: persistedCardStyleRef.current })
  }, [flushShowcaseStyle, railResId])

  useEffect(() => {
    if (!pendingStylePatch.current) setCardStyleDraft((current) => current.resonatorId === railResId && current.style === persistedCardStyle
      ? current : { resonatorId: railResId, style: persistedCardStyle })
  }, [persistedCardStyle, railResId])

  useEffect(() => flushShowcaseStyle, [flushShowcaseStyle])

  const [cssExpanded, setCssExpanded] = useState(false)
  const [tuneDrawerOpen, setTuneDrawerOpen] = useState(false)
  // session uploads are deliberately kept outside persisted preferences.
  const [sessionImages, setSessionImages] = useState<Record<string, { portrait?: string; backdrop?: string }>>({})
  const sessionImagesRef = useRef(sessionImages)
  sessionImagesRef.current = sessionImages
  const [uploadTarget, setUploadTarget] = useState<'portrait' | 'backdrop'>('portrait')
  const uploadModal = useAppModal()
  // session images override persisted refs; IndexedDB refs resolve only while active.
  const sessionForRail = railResId ? sessionImages[railResId] : undefined
  const portraitRef = sessionForRail?.portrait ?? cardStyle.portraitImage
  const backdropRef = sessionForRail?.backdrop ?? cardStyle.backdropImage
  const [displayEdge, setDisplayEdge] = useState(2048)
  useEffect(() => {
    const card = buildCardRef.current
    if (!card || !isShowcase) return
    let timer = 0
    const measure = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const zoom = Math.max(2, (cardStyle.portraitScale ?? 50) / 50, (cardStyle.backdropScale ?? 50) * 3 / 100)
        const pixels = Math.max(card.clientWidth, card.clientHeight) * window.devicePixelRatio * zoom
        setDisplayEdge(Math.min(8192, Math.max(512, 2 ** Math.ceil(Math.log2(pixels)))))
      }, 180)
    }
    const resize = new ResizeObserver(measure)
    resize.observe(card); measure()
    return () => { resize.disconnect(); window.clearTimeout(timer) }
  }, [isShowcase, cardStyle.portraitScale, cardStyle.backdropScale])
  const portraitImage = useResolvedImageRef(portraitRef, Boolean(railResId), displayEdge)
  const backdropImage = useResolvedImageRef(backdropRef, Boolean(railResId), displayEdge)
  const resolvedPortrait = portraitImage?.url ?? null
  const resolvedBackdrop = backdropImage?.url ?? null
  const derivedSurfaceColor = sampledSurface?.resonatorId === railResId && sampledSurface.imageRef === portraitRef
    ? sampledSurface.color
    : DEFAULT_PORTRAIT_SURFACE
  const surfaceColor = cardStyle.surface ?? derivedSurfaceColor
  const textColor = cardStyle.text ?? inkForSurface(surfaceColor)

  const [portraitSource, setPortraitSource] = useState<{ owner: string | null; ref: string | null; source: string } | null>(null)
  const onPortraitReady = useCallback((source: string) => setPortraitSource((previous) => previous?.owner === railResId && previous.ref === portraitRef && previous.source === source ? previous : { owner: railResId, ref: portraitRef, source }), [portraitRef, railResId])
  useEffect(() => {
    if (!isShowcase || !railResId || !portraitSource || portraitSource.owner !== railResId || portraitSource.ref !== portraitRef) return
    let active = true
    void readPortraitSurface(portraitSource.source, portraitRef || undefined).then((color) => {
      if (active) setSampledSurface((previous) => previous?.resonatorId === railResId && previous.imageRef === portraitRef && previous.color === color ? previous : { resonatorId: railResId, imageRef: portraitRef, color })
    })
    return () => { active = false }
  }, [isShowcase, portraitSource, portraitRef, railResId])

  useEffect(() => () => {
    for (const images of Object.values(sessionImagesRef.current)) {
      if (images.portrait?.startsWith('blob:')) URL.revokeObjectURL(images.portrait)
      if (images.backdrop?.startsWith('blob:')) URL.revokeObjectURL(images.backdrop)
    }
  }, [])

  const handlePickImage = useCallback((target: 'portrait' | 'backdrop') => {
    setUploadTarget(target)
    uploadModal.show()
  }, [uploadModal])

  const handleApplyImage = useCallback((result: StoredImage, credit: string) => {
    if (!railResId) return
    const creditValue = credit.trim() || null
    const creditPatch = uploadTarget === 'portrait'
      ? { portraitCredit: creditValue }
      : { backdropCredit: creditValue }
    if (result.persisted) {
      updateShowcaseStyle(uploadTarget === 'portrait'
        ? { portraitImage: result.ref, ...creditPatch }
        : { backdropImage: result.ref, ...creditPatch })
      setSessionImages((prev) => {
        const current = prev[railResId]
        if (!current) return prev
        const previousRef = current[uploadTarget]
        if (previousRef?.startsWith('blob:')) URL.revokeObjectURL(previousRef)
        return { ...prev, [railResId]: { ...current, [uploadTarget]: undefined } }
      })
    } else {
      // credits remain persisted even when the selected image is session-only.
      updateShowcaseStyle(creditPatch)
      setSessionImages((prev) => {
        const previousRef = prev[railResId]?.[uploadTarget]
        if (previousRef?.startsWith('blob:')) URL.revokeObjectURL(previousRef)
        return {
          ...prev,
          [railResId]: { ...prev[railResId], [uploadTarget]: result.ref },
        }
      })
    }
    setEditMode(uploadTarget)
  }, [railResId, updateShowcaseStyle, uploadTarget])

  // reset persisted and session fields for one image group.
  const handleResetGroup = useCallback((group: 'portrait' | 'backdrop') => {
    if (!railResId) return
    if (group === 'portrait') {
      updateShowcaseStyle({
        portraitImage: null,
        portraitCredit: null,
        portraitX: null,
        portraitY: null,
        portraitScale: null,
        maskTop: null,
        maskRight: null,
        maskBottom: null,
        maskLeft: null,
        maskTopSharp: null,
        maskRightSharp: null,
        maskBottomSharp: null,
        maskLeftSharp: null,
      })
      patchShowcaseCardHidden(railResId, { portraitCredit: false })
    } else {
      updateShowcaseStyle({
        backdropImage: null,
        backdropCredit: null,
        backdropX: null,
        backdropY: null,
        backdropScale: null,
        backdropBlur: null,
        backdropOpacity: null,
      })
      patchShowcaseCardHidden(railResId, { backdropCredit: false })
    }
    setSessionImages((prev) => {
      const current = prev[railResId]
      if (!current) return prev
      const previousRef = current[group]
      if (previousRef?.startsWith('blob:')) URL.revokeObjectURL(previousRef)
      return { ...prev, [railResId]: { ...current, [group]: undefined } }
    })
    setEditMode(null)
  }, [railResId, patchShowcaseCardHidden, updateShowcaseStyle])

  const handleResetTuneSection = useCallback((section: 'show' | 'color' | 'type') => {
    if (!railResId) return
    if (section === 'show') {
      updateShowcaseStyle({ statsColumn: null, portraitCredit: null, backdropCredit: null })
      patchShowcaseCardHidden(railResId, DEF_SHOWCASE_HIDE)
    } else if (section === 'color') {
      updateShowcaseStyle({ accent: null, surface: null, opacity: null })
    } else {
      updateShowcaseStyle({ displayFont: null, monoFont: null, text: null })
    }
  }, [patchShowcaseCardHidden, railResId, updateShowcaseStyle])

  const handleExportTarget = useCallback(async (target: CardExportTarget) => {
    const style = { ...cardStyle, ...previewPatch.current }
    flushShowcaseStyle()
    const { buildCardExport } = await import('@/modules/simulation/surfaces/showcase/cardTransfer.ts')
    const { raw, filename, mime } = buildCardExport(target, style, cardHidden)

    if (mime === 'application/json') {
      const { xprtAppFile } = await import('@/application/persistence/fileCodec.ts')
      await xprtAppFile(filename, raw)
      return
    }
    const blob = new Blob([raw], { type: mime })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }, [cardStyle, cardHidden, flushShowcaseStyle])

  const handleImportFile = useCallback(async (file: File) => {
    if (!railResId) return
    try {
      const [{ parseCardImport }, { readAppFile }] = await Promise.all([
        import('@/modules/simulation/surfaces/showcase/cardTransfer.ts'),
        import('@/application/persistence/fileCodec.ts'),
      ])
      const result = parseCardImport(file.name, await readAppFile(file))
      if (result.stylePatch) updateShowcaseStyle(result.stylePatch)
      if (result.hiddenPatch) patchShowcaseCardHidden(railResId, result.hiddenPatch)
      showToast({ content: `Imported ${result.label}.`, variant: 'success' })
    } catch (error) {
      showToast({ content: error instanceof Error ? error.message : 'That card file could not be imported.', variant: 'error' })
    }
  }, [railResId, patchShowcaseCardHidden, showToast, updateShowcaseStyle])
  // convert neutral-at-50 controls into offsets around canonical spine placement.
  const showcasePlacement = useMemo(() => {
    const base = getEvaluationSpinePlacement(railResId)
    return {
      x: base.x - (((cardStyle.portraitX ?? 50) - 50) / 50) * 800,
      y: base.y - (((cardStyle.portraitY ?? 50) - 50) / 50) * 800,
      scale: base.scale * (0.5 + (cardStyle.portraitScale ?? 50) / 100),
    }
  }, [railResId, cardStyle.portraitX, cardStyle.portraitY, cardStyle.portraitScale])

  const backdropStyle = useMemo<CssVars>(() => {
    return {
      ...(cardStyle.backdropOpacity != null ? { '--asset-base-opacity': cardStyle.backdropOpacity / 100 } : {}),
      ...(cardStyle.backdropBlur != null
        ? { '--asset-base-filter': `blur(${((cardStyle.backdropBlur / 100) * 20).toFixed(1)}px) saturate(1.3)` }
        : {}),
      ...(resolvedBackdrop ? { backgroundImage: `url("${resolvedBackdrop}")` } : {}),
      ...(cardStyle.backdropScale != null ? { backgroundSize: `${cardStyle.backdropScale * 3}%` } : {}),
      ...(cardStyle.backdropX != null || cardStyle.backdropY != null
        ? { backgroundPosition: `${cardStyle.backdropX ?? 50}% ${cardStyle.backdropY ?? 28}%` }
        : {}),
    }
  }, [
    cardStyle.backdropOpacity,
    cardStyle.backdropBlur,
    resolvedBackdrop,
    cardStyle.backdropScale,
    cardStyle.backdropX,
    cardStyle.backdropY,
  ])
  const captureBuildCard = useCallback(async (action: 'download' | 'clipboard') => {
    const card = buildCardRef.current
    if (!card || !isShowcase || captureAction) return

    flushShowcaseStyle()
    setCaptureAction(action)
    try {
      const capture = import('@/modules/simulation/surfaces/showcase/captureBuildCard.ts')
      const png = capture.then(async ({ renderBuildCardPng }) => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        return renderBuildCardPng(card)
      })
      if (action === 'clipboard') {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image clipboard is unavailable in this browser.')
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
        showToast({ content: 'Build card copied to clipboard.', variant: 'success' })
      } else {
        const { downloadBuildCard } = await capture
        downloadBuildCard(await png, railModel.seed?.name ?? 'build')
        showToast({ content: 'Build card captured.', variant: 'success' })
      }
    } catch (error) {
      showToast({
        content: error instanceof Error ? error.message : 'Build card capture failed.',
        variant: 'error',
      })
    } finally {
      setCaptureAction(null)
    }
  }, [captureAction, flushShowcaseStyle, isShowcase, railModel.seed?.name, showToast])

  const resetCardStyle = useCallback(() => {
    if (railResId) {
      discardPendingShowcaseStyle()
      resetShowcaseCard(railResId)
      setCardStyleDraft({ resonatorId: railResId, style: DEF_SHOWCASE_CARD_STYLE })
    }
    setEditMode(null)
    setTuneResetKey((key) => key + 1)
  }, [discardPendingShowcaseStyle, railResId, resetShowcaseCard])

  const boardContextItems = useMemo<MenuEntry[]>(() => isShowcase ? [
    {
      id: 'showcase:copy-image', label: 'Copy card image',
      icon: <Clipboard size="1em" />,
      disabled: captureAction !== null,
      onSelect: () => { void captureBuildCard('clipboard') },
    },
    {
      id: 'showcase:download-image', label: 'Download card image',
      icon: <TbCameraDown size="1em" />,
      disabled: captureAction !== null,
      onSelect: () => { void captureBuildCard('download') },
    },
    {
      id: 'showcase:customize', label: 'Customize card',
      icon: <SlidersHorizontal size="1em" />,
      onSelect: () => setTuneDrawerOpen(true),
    },
    { type: 'separator' },
    ...(stageContextItems ?? []),
    { type: 'separator' },
    {
      id: 'showcase:reset-card', label: 'Reset card style',
      icon: <RotateCcw size="1em" />, danger: true,
      onSelect: resetCardStyle,
    },
  ] : stageContextItems ?? [], [captureAction, captureBuildCard, isShowcase, resetCardStyle, stageContextItems])
  const maskVars = useMemo<CssVars>(() => ({
    ...(cardStyle.maskTop != null ? { '--mask-top': `${cardStyle.maskTop}%` } : {}),
    ...(cardStyle.maskRight != null ? { '--mask-right': `${cardStyle.maskRight}%` } : {}),
    ...(cardStyle.maskBottom != null ? { '--mask-bottom': `${cardStyle.maskBottom}%` } : {}),
    ...(cardStyle.maskLeft != null ? { '--mask-left': `${cardStyle.maskLeft}%` } : {}),
    ...(cardStyle.maskTopSharp != null ? { '--mask-top-sharp': cardStyle.maskTopSharp / 100 } : {}),
    ...(cardStyle.maskRightSharp != null ? { '--mask-right-sharp': cardStyle.maskRightSharp / 100 } : {}),
    ...(cardStyle.maskBottomSharp != null ? { '--mask-bottom-sharp': cardStyle.maskBottomSharp / 100 } : {}),
    ...(cardStyle.maskLeftSharp != null ? { '--mask-left-sharp': cardStyle.maskLeftSharp / 100 } : {}),
  }), [
    cardStyle.maskTop, cardStyle.maskRight, cardStyle.maskBottom, cardStyle.maskLeft,
    cardStyle.maskTopSharp, cardStyle.maskRightSharp, cardStyle.maskBottomSharp, cardStyle.maskLeftSharp,
  ])

  // convert semantic text-role overrides into the css-variable contract.
  const textSlotVars = useMemo(() => buildTextSlotVars(cardStyle.textSlots ?? {}), [cardStyle.textSlots])

  // hoist at-rules that are invalid inside @scope and scope the remaining declarations.
  const customCssParts = useMemo(
    () => (cardStyle.customCss ? splitHoistedCss(cardStyle.customCss) : null),
    [cardStyle.customCss],
  )
  const scopedCustomCss = useMemo(
    () => isShowcase && customCssParts
      ? `${customCssParts.hoisted}\n@scope (.wk-rail-wrapper, .wk-rail) to (.wk-tune) {\n${customCssParts.scoped}\n}`
      : null,
    [customCssParts, isShowcase],
  )
  const railStyle = useMemo<CssVars>(() => ({
    '--resonator-accent': isShowcase ? cardStyle.accent ?? railModel.accent : railModel.accent,
    ...(isShowcase ? { '--bg': surfaceColor } : {}),
    ...(isShowcase ? { '--text': textColor } : {}),
    ...(isShowcase
      ? {
          '--rail-glass': `color-mix(in srgb, var(--bg) ${cardStyle.opacity ?? 82}%, transparent)`,
          '--rail-glass-2': `color-mix(in srgb, var(--bg) ${Math.round((cardStyle.opacity ?? 82) * 0.67)}%, transparent)`,
        }
      : {}),
    ...(isShowcase && cardStyle.displayFont ? { '--display-font': cardStyle.displayFont } : {}),
    ...(isShowcase && cardStyle.monoFont ? { '--mono-font': cardStyle.monoFont } : {}),
    ...maskVars,
    ...(isShowcase ? textSlotVars : {}),
  }), [
    cardStyle.accent,
    cardStyle.displayFont,
    cardStyle.monoFont,
    cardStyle.opacity,
    isShowcase,
    maskVars,
    railModel.accent,
    surfaceColor,
    textColor,
    textSlotVars,
  ])

  // apply inherited css changes directly to the card once per frame.
  const appliedVars = useRef<string[]>([])
  useLayoutEffect(() => {
    const card = buildCardRef.current
    if (!card) return
    for (const key of appliedVars.current) if (!(key in railStyle)) card.style.removeProperty(key)
    const keys = Object.keys(railStyle)
    for (const key of keys) {
      const value = String(railStyle[key])
      if (card.style.getPropertyValue(key) !== value) card.style.setProperty(key, value)
    }
    appliedVars.current = keys
    card.dispatchEvent(new Event('showcase:appearance'))
  }, [railStyle])

  useEffect(() => {
    buildCardRef.current?.dispatchEvent(new Event('showcase:typography'))
  }, [cardStyle.displayFont, cardStyle.monoFont, cardStyle.textSlots, cardStyle.customCss])

  // persisted font stacks require their external family stylesheets to be rehydrated.
  useEffect(() => {
    if (!isShowcase) return
    const families = collectCardFontFamilies({
      displayFont: cardStyle.displayFont,
      monoFont: cardStyle.monoFont,
      textSlots: cardStyle.textSlots ?? {},
    })
    ensureShowcaseFonts()
    for (const family of families) ensureGoogleFamily(family)
  }, [isShowcase, cardStyle.displayFont, cardStyle.monoFont, cardStyle.textSlots])


return <ContextTrigger asChild ariaLabel="Build Lab stage actions" items={boardContextItems}>
            <BuildWorkspaceBoard
              ref={boardRef}
              page={page}
              onPointerUpCapture={flushShowcaseStyle}
              onBlurCapture={flushShowcaseStyle}
              data-css-expanded={isShowcase && cssExpanded ? 'true' : undefined}
            >
            {isShowcase && cssExpanded ? (
              <Suspense fallback={<div className="wk-css-dock"><AppLdrVrly mode="centered" text="Loading CSS editor..." /></div>}>
              <ShowcaseCssEditorDock
                value={cardStyle.customCss ?? ''}
                isDark={isDarkTheme}
                onChange={(value) => {
                  updateShowcaseStyle({ customCss: value || null })
                }}
                onClose={() => {
                  setCssExpanded(false)
                  setTuneDrawerOpen(false)
                }}
              />
              </Suspense>
            ) : null}
            <BuildWorkspaceWorkspace>
              <BuildWorkspaceRailSlot>
                <BuildRail {...railProps}
                  buildCardRef={buildCardRef} onPortraitReady={onPortraitReady} customCss={scopedCustomCss}
                  editMode={editMode} cardHidden={cardHidden} railStyle={EMPTY_RAIL_STYLE}
                  backdropStyle={backdropStyle} statsColumn={cardStyle.statsColumn ?? 'build'}
                  portraitCredit={cardStyle.portraitCredit} backdropCredit={cardStyle.backdropCredit}
                  resolvedPortrait={resolvedPortrait} capturePortrait={portraitImage?.original} captureBackdrop={backdropImage?.original} showcasePlacement={showcasePlacement}
                  autoImageContrast={cardStyle.text == null} layout={showcaseLayout}
                />
                <MemoRailDock {...dockProps} />
                {isShowcase && (
                  <Suspense fallback={<AppLdrVrly mode="inline" text="Loading Showcase controls..." />}>
                  <ShowcaseCustomizePanel
                    key={tuneResetKey}
                    layout={showcaseLayout}
                    onLayoutChange={setShowcaseLayout}
                    accent={cardStyle.accent ?? railModel.accent}
                    surface={surfaceColor}
                    text={textColor}
                    cardOpacity={cardStyle.opacity ?? 82}
                    portraitX={cardStyle.portraitX ?? 50}
                    portraitY={cardStyle.portraitY ?? 50}
                    portraitScale={cardStyle.portraitScale ?? 50}
                    maskTop={cardStyle.maskTop ?? 0}
                    maskRight={cardStyle.maskRight ?? 0}
                    maskBottom={cardStyle.maskBottom ?? 45}
                    maskLeft={cardStyle.maskLeft ?? 0}
                    maskTopSharp={cardStyle.maskTopSharp ?? 0}
                    maskRightSharp={cardStyle.maskRightSharp ?? 0}
                    maskBottomSharp={cardStyle.maskBottomSharp ?? 0}
                    maskLeftSharp={cardStyle.maskLeftSharp ?? 0}
                    portraitImage={resolvedPortrait}
                    backdropImage={resolvedBackdrop}
                    resId={railResId}
                    fallbackArt={railModel.portraitSrc}
                    displayFont={cardStyle.displayFont ?? null}
                    backdropX={cardStyle.backdropX ?? (cardStyle.backdropY == null ? 20 : 50)}
                    backdropY={cardStyle.backdropY ?? (cardStyle.backdropX == null ? 50 : 28)}
                    backdropScale={cardStyle.backdropScale ?? 67}
                    backdropBlur={cardStyle.backdropBlur ?? 30}
                    backdropOpacity={cardStyle.backdropOpacity ?? 67}
                    statsColumn={cardStyle.statsColumn ?? 'build'}
                    portraitCredit={cardStyle.portraitCredit ?? ''}
                    backdropCredit={cardStyle.backdropCredit ?? ''}
                    textSlots={cardStyle.textSlots ?? {}}
                    customCss={cardStyle.customCss ?? ''}
                    editMode={editMode}
                    onEdit={(group) => setEditMode((prev) => (prev === group ? null : group))}
                    hidden={cardHidden}
                    onToggleHidden={(key) => {
                      if (railResId) toggleShowcaseHide(railResId, key)
                    }}
                    onStyleChange={(patch) => {
                      updateShowcaseStyle(patch)
                    }}
                    onResetSection={handleResetTuneSection}
                    onPickImage={handlePickImage}
                    onResetGroup={handleResetGroup}
                    onReset={resetCardStyle}
                    onCapture={captureBuildCard}
                    captureAction={captureAction}
                    capturing={captureAction != null}
                    onExport={handleExportTarget}
                    onImportFile={handleImportFile}
                    docked={cssExpanded}
                    drawerOpen={tuneDrawerOpen}
                    onToggleDrawer={() => setTuneDrawerOpen((open) => !open)}
                    onExpandCss={() => {
                      setCssExpanded((on) => !on)
                      setTuneDrawerOpen(false)
                    }}
                  />
                  </Suspense>
                )}
                {isShowcase && uploadModal.visible && (
                  <Suspense fallback={<AppLdrVrly mode="centered" text="Loading image upload..." />}><ImageUploadModal
                    state={uploadModal.dialogProps}
                    title={uploadTarget === 'portrait' ? 'Portrait image' : 'Backdrop image'}
                    initialCredit={(uploadTarget === 'portrait' ? cardStyle.portraitCredit : cardStyle.backdropCredit) ?? ''}
                    onClose={uploadModal.hide}
                    onApply={handleApplyImage}
                  /></Suspense>
                )}
              </BuildWorkspaceRailSlot>
<ResolvedBackdropContext.Provider value={resolvedBackdrop}>{children}</ResolvedBackdropContext.Provider>
</BuildWorkspaceWorkspace></BuildWorkspaceBoard></ContextTrigger>
}
