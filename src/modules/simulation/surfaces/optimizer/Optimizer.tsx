/*
  Author: Runor Ewhro
  description: coordinates optimizer settings, search execution, result
               filtering, preview state, and build application.
*/

import { createOptimizerProgress } from './lib/progressStore'
import {type ReactNode, lazy, Suspense, useCallback, useRef} from 'react'
import {useEffect, useLayoutEffect as useLytFfct, useMemo, useState} from 'react'
import { useNavX } from '@/shared/navigation/useNavX'
import type {RotationNode} from '@/domain/gameData/contracts'
import {
  cloneEchoLoadout,
} from '@/domain/entities/inventoryStorage.ts'
import { OptimizerLab } from './transport/OptimizerLab.tsx'
import { OptStage } from './transport/OptStage.tsx'
import { OptTransport } from './transport/OptTransport.tsx'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import { cloneOptSets } from '@/engine/runtime/defaults'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { useAppModal, useAppModalValue } from '@/shared/ui/useAppModal.ts'
import { useConfigurationSession } from '@/shared/ui/useConfigurationSession.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import type {SelectOption, SelectGroup} from '@/application/ui/Select'
import {getGameDataMode} from '@/data/gameData'
import { useSavedRotationsLease } from '@/application/hooks/useSavedRotationsLease.ts'
import { useResonatorData } from '@/application/hooks/useResonatorData.ts'
import {getEchoById, listEchoes} from '@/data/catalog/echoCatalogService'
import {weaponEquipState} from '@/engine/optimizer/context/weaponOverlays.ts'
import {getWpnById} from '@/data/catalog/weaponCatalogService'
import { listRotationDamageSources, resolveRotationDamageSource, rotationCombatSetup, rotationDamageContext } from '@/engine/rotation/damageSource.ts'
import { makeRuntimeMap, mkPartRtLkp } from '@/engine/runtime/runtimeAdapters'
import {useAppStore} from '@/application/state'
import { useOptimizerRunStore } from '@/application/state/optimizerRunStore'
import {
  selActTgtSlc,
  selEnemyProf,
  selScenarioProfiles,
} from '@/application/state'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { contextScenarioMember } from '@/domain/entities/combatScenario.ts'
import { indexEquippedEchoes } from '@/engine/runtime/inventoryUsage.ts'
import {deriveOptSets, preserveToggles} from '@/engine/optimizer/config/defaultSettings.ts'
import {applyKeepPrc, makeStatWeights} from '@/engine/search/score/statWeights.ts'
import {compOptTgtCt} from '@/engine/search/context/target'
import {listOptTrgt} from '@/engine/optimizer/target/skills'
import {countOptCombos, countTheory} from '@/engine/optimizer/search/counting'
import { optSetIdSet } from '@/engine/optimizer/config/allowedSets.ts'
import type { CompactTheoryResult, OptBagResult, TheoryResult, TheoryResultRow } from '@/engine/optimizer/types'
import type { OptResultStats } from '@/engine/search/score/core'
import type { OptBaselineInput, OptCompOutMs } from '@/engine/optimizer/compiler/compileWorker.types.ts'
import {seedRsntById} from '@/modules/simulation/features/resonator/lib/seedData.ts'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'


import {
  SetCond
} from '@/modules/simulation/features/controls/SetConditional.tsx'





import {
  type OptDisplayRow,
  Row, OptimizerResultRows
} from '@/modules/simulation/surfaces/optimizer/Row.tsx'

import {HEADER_TITLES} from '@/modules/simulation/surfaces/optimizer/lib/mockData.ts'
import { OPT_SKILL_TABS, getSkillTabLabel } from '@/modules/simulation/model/skillTabs'
import { skillDisplayColor } from '@/modules/simulation/surfaces/rotation/shared/skillDisplay.ts'
import {modalContent} from '@/modules/simulation/surfaces/optimizer/Modals.tsx'
import { ResultToolbar } from '@/modules/simulation/surfaces/optimizer/ResultToolbar.tsx'

import {
  plchRslt,
  vsblRsltsAt as getRowsAt,
  type LegOptRsltEn,
  prvwChs as getPreview,
  rsltLdt,
  buildFacetSlice,
  buildResultView,
  facetMatches,
  isDefaultViewCriteria,
  viewNeedsStats,
  DEFAULT_VIEW_CRITERIA,
  type ResultViewCriteria,
  ResultFacetTable,
  type Predicate,
} from '@/modules/simulation/surfaces/optimizer/lib/results.ts'
import {
  type EchoPlan,
  derEchoPlan,
  resEchoPlan,
  selMainEcho,
} from '@/modules/simulation/surfaces/optimizer/lib/teammateEchoPlan.ts'
import {
  mkMptyPrgr,
  mkMptyEchoPl,
  mapMainStatF,
  makeOpSlot,
  normEchoLdt,
  type OpEchoTarget,
  type PrvwTgt,
  smmrEchoLdt,
} from '@/modules/simulation/surfaces/optimizer/lib/helpers.ts'
import { useMenuContributions } from '@/application/context-menu/AppContextMenu'
import type { MenuContribution } from '@/application/context-menu/menuContributions'

interface OptimizerSurfaceMenuContext {
  running: boolean
  pending: boolean
  hasResults: boolean
  run: () => void
  halt: () => void
  clear: () => void
  openInventory: () => void
  openRules: () => void
}

const optimizerSurfaceMenu: MenuContribution<OptimizerSurfaceMenuContext>[] = [
  {
    id: 'optimizer-run-controls',
    group: '1_primary',
    build: ({ running, pending, hasResults, run, halt, clear }) => [
      running
        ? { id: 'optimizer-halt', label: 'Halt search', onSelect: halt }
        : { id: 'optimizer-run', label: 'Run search', disabled: pending, onSelect: run },
      ...(hasResults ? [{ id: 'optimizer-clear', label: 'Clear results', onSelect: clear }] : []),
    ],
  },
  {
    id: 'optimizer-tools',
    group: '2_tools',
    build: ({ openInventory, openRules }) => [
      { id: 'optimizer-inventory', label: 'Inventory filter', onSelect: openInventory },
      { id: 'optimizer-rules', label: 'Optimizer rules', onSelect: openRules },
    ],
  },
]

// bound transition waits even when no completion event arrives.
const BAND_SETTLE_CAP_MS = 700

// delay synchronous compilation until react commits the fold and its active
// transitions finish. skip the wait when no transition runs or motion is reduced.
function settleBand(band: HTMLElement | null): Promise<unknown> {
  if (!band) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      const folds = [band, ...Array.from(band.children)]
        .flatMap((node) => node.getAnimations())
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished)

      if (folds.length === 0) {
        resolve()
        return
      }

      const cap = window.setTimeout(resolve, BAND_SETTLE_CAP_MS)
      void Promise.allSettled(folds).then(() => {
        window.clearTimeout(cap)
        resolve()
      })
    })
  })
}


// a runtime wearing a result's loadout, plus the weapon its search picked
function withRsltLoadout(
  runtime: ResRuntime,
  echoes: Array<EchoInstance | null>,
  equip: ReturnType<typeof weaponEquipState>,
): ResRuntime {
  return {
    ...runtime,
    build: {
      ...runtime.build,
      echoes,
      ...(equip ? { weapon: { ...runtime.build.weapon, ...equip.weapon } } : {}),
    },
    ...(equip
      ? { state: { ...runtime.state, controls: { ...runtime.state.controls, ...equip.controls } } }
      : {}),
  }
}

export function Optimizer() {
  useMenuContributions('optimizer.surface', optimizerSurfaceMenu)
  const navigate = useNavX()
  const activeTarget = useAppStore(selActTgtSlc)
  const enemyProfile = useAppStore(selEnemyProf)
  const scenario = useAppStore((state) => selectedCombatScenario(state.combat))
  const scenarioWorkspace = useAppStore((state) => state.combat)
  const liveScenarios = useMemo(() => scenarioWorkspace.order.flatMap((id) => {
    const entry = scenarioWorkspace.scenariosById[id]
    return entry ? [entry] : []
  }), [scenarioWorkspace])
  const optimizerMember = contextScenarioMember(scenario)
  const optResId = optimizerMember.resonatorId
  const optRuntimesById = useMemo(() => mkPartRtLkp(scenario), [scenario])
  const optRt = optRuntimesById[optResId] ?? null
  const storedOptSets = useAppStore((state) => state.simulation.optimizerSettings)
  const optSetsResonatorId = useAppStore(
    (state) => state.simulation.optimizerSettingsResonatorId,
  )
  const needsTargetDefaults = optSetsResonatorId !== optResId || (
    !storedOptSets.targetSkillId && !storedOptSets.targetComboSourceId
  )
  const optSets = useMemo(() => {
    if (!optRt || !needsTargetDefaults) {
      return storedOptSets
    }

    return cloneOptSets({
      ...deriveOptSets({
        runtime: optRt,
        runtimesById: optRuntimesById,
        enemy: enemyProfile,
        selectedTargets: activeTarget,
      }),
      ...preserveToggles(storedOptSets),
    })
  }, [activeTarget, enemyProfile, needsTargetDefaults, optRt, optRuntimesById, storedOptSets])
  useSavedRotationsLease()
  const savedRotations = useAppStore((state) => state.library.rotations)
  const savedRotationsHydrated = useAppStore((state) => state.savedRotationsHydrated)
  const optStts = useOptimizerRunStore((state) => state.status)
  const optResults = useOptimizerRunStore((state) => (
    Array.isArray(state.results)
      ? state.results
      : []
  ) as Array<OptBagResult | LegOptRsltEn | TheoryResult | CompactTheoryResult | TheoryResultRow>)
  const optRrr = useOptimizerRunStore((state) => state.error)
  const optBtchSize = useOptimizerRunStore((state) => state.batchSize)
  const optResultData = useOptimizerRunStore((state) => state.resPay)
  const optResultEchoes = useOptimizerRunStore((state) => (
    Array.isArray(state.resultEchoes)
      ? state.resultEchoes
      : []
  ))
  const invEchoEnts = useAppStore((state) => state.library.echoes)
  const optCpuHintSe = useAppStore((state) => state.ui.optimizerCpuHintSeen)
  const setOptCpuHin = useAppStore((state) => state.setOptHint)
  const updResRt = useAppStore((state) => state.updResRt)
  const updOptSets = useAppStore((state) => state.updOptSets)
  const updResSetCon = useAppStore((state) => state.updResConds)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const startOpt = useAppStore((state) => state.startOpt)
  const weaponSuggests = useAppStore((state) => state.simulation.weaponSuggests)
  const cnclOpt = useAppStore((state) => state.cnclOpt)
  const clrOptRslts = useAppStore((state) => state.clrOptRslt)
  const disposeOptResources = useAppStore((state) => state.disposeOptResources)
  const updateScenarioRuntime = useCallback((updater: (runtime: ResRuntime) => ResRuntime) => {
    updResRt(optResId, updater)
  }, [optResId, updResRt])
  const optInvSelection = optimizerMember.local.optimizerInventory
  const updResOptInv = useAppStore((state) => state.updResOptInv)
  const optSetConds = optimizerMember.local.setConditionals
  const activeSeed = seedRsntById[optResId] ?? null
  const displayName = activeSeed?.name ?? 'Unknown'
  const rotationMode = optSets.rotationMode
  const targetMode: 'skill' | 'combo' = rotationMode ? 'combo' : 'skill'
  const optMode = optSets.searchMode
  const isThryMode = optMode === 'theory'

  const [pageIndex, setPageIndex] = useState(0)
  const [viewCriteria, setViewCriteria] = useState<ResultViewCriteria>(DEFAULT_VIEW_CRITERIA)
  // whether the filter/sort controls are expanded; opening them arms the facet
  // pass. the dropdowns then list available echoes, sets, and plans.
  const [optToolsOpen, setOptToolsOpen] = useState(false)
  const [facetTable, setFacetTable] = useState<ResultFacetTable | null>(null)
  // which console mode the body shows: filter (where, subsets) or find (jump).
  const [consoleMode, setConsoleMode] = useState<'filter' | 'find'>('filter')
  // find predicates navigate within the filtered view without removing rows.
  // findPos records the last matching display position.
  const [findPreds, setFindPreds] = useState<Predicate[]>([])
  const [findPos, setFindPos] = useState(-1)
  // index into pageItems whose ellipsis is currently expanded into a jumper
  // input. only one ellipsis can be in edit mode at a time; null = inactive.
  const [jumpEditNdx, setJumpEditNdx] = useState<number | null>(null)
  const [jumpDraft, setJumpDraft] = useState('')
  const jumpInputRef = useRef<HTMLInputElement | null>(null)
  const bandRef = useRef<HTMLDivElement | null>(null)
  const [prvwTrgt, setPrvwTrgt] = useState<PrvwTgt>({ kind: 'base' })
  const [echoPlanStr, setEchoPlanS] = useState<{
    resonatorId: string | null
    plans: [EchoPlan | null, EchoPlan | null]
  }>(() => ({
    resonatorId: null,
    plans: mkMptyEchoPl(),
  }))
  const [progressSource] = useState(() => createOptimizerProgress(mkMptyPrgr()))
  const setProgress = progressSource.update
  const uiModal = useAppModalValue<ReactNode>()
  const rulesModal = useAppModal()
  const setCondsMdl = useAppModal()
  const wpnCondMdl = useAppModal()
  const optInvMdl = useAppModal()
  const mainEchoPckr = useAppModalValue<OpEchoTarget>()

  const mdlPrtlTgt = mainPortal()
  const mainEchoSession = useConfigurationSession({
    source: optSets,
    active: mainEchoPckr.visible,
    commit: updOptSets,
  })

  const echoPlans = useMemo(
    () => (
      echoPlanStr.resonatorId === optResId
        ? echoPlanStr.plans
        : mkMptyEchoPl()
    ),
    [optResId, echoPlanStr],
  )

  const setEchoPlans = useCallback((
    action:
      | [EchoPlan | null, EchoPlan | null]
      | ((
        prev: [EchoPlan | null, EchoPlan | null]
      ) => [EchoPlan | null, EchoPlan | null]),
  ) => {
    setEchoPlanS((prevStore) => {
      const prvsPlns = prevStore.resonatorId === optResId
        ? prevStore.plans
        : mkMptyEchoPl()
      const nextPlans = typeof action === 'function'
        ? action(prvsPlns)
        : action

      return {
        resonatorId: optResId,
        plans: nextPlans,
      }
    })
  }, [optResId])

  const mateEchoPlan = useMemo(() => {
    if (!optRt) {
      return {
        runtime: null,
        runtimesById: {} as Record<string, ResRuntime>,
        plans: [null, null] as [EchoPlan | null, EchoPlan | null],
        invalidMainEchoes: [null, null] as [string | null, string | null],
      }
    }

    const rslvPlns = [...echoPlans] as [EchoPlan | null, EchoPlan | null]
    const nvldMainChs: [string | null, string | null] = [null, null]
    const nextRuntimesById = { ...optRuntimesById }
    let changed = false

    // teammate echo plans are authored as lightweight preferences, so rebuild
    // the concrete teammate loadouts here before downstream optimizer prep.
    for (const slotIndex of [0, 1] as const) {
      const memRt = makeOpSlot(optRt, slotIndex, optRuntimesById)
      if (!memRt) {
        continue
      }

      const resolvedPlan = resEchoPlan(
        memRt.build.echoes,
        echoPlans[slotIndex],
      )
      rslvPlns[slotIndex] = resolvedPlan.plan
      nvldMainChs[slotIndex] = resolvedPlan.invalidMainId

      if (resolvedPlan.effectEchoes.every((echo, echoIndex) => echo === memRt.build.echoes[echoIndex])) {
        continue
      }

      nextRuntimesById[memRt.id] = {
        ...memRt,
        build: {
          ...memRt.build,
          echoes: resolvedPlan.effectEchoes,
        },
      }
      changed = true
    }

    return {
      runtime: optRt,
      runtimesById: changed ? nextRuntimesById : optRuntimesById,
      plans: rslvPlns,
      invalidMainEchoes: nvldMainChs,
    }
  }, [optRt, optRuntimesById, echoPlans])

  const effectRuntime = mateEchoPlan.runtime
  const effectRuntimesById = mateEchoPlan.runtimesById
  const rslvEchoPlns = mateEchoPlan.plans
  const clearRun = useCallback(() => {
    clrOptRslts()
    setPageIndex(0)
    setPrvwTrgt({ kind: 'base' })
    setProgress(mkMptyPrgr())
  }, [clrOptRslts, setProgress])

  useEffect(() => () => {
    disposeOptResources()
  }, [disposeOptResources])

  useLytFfct(() => {
    if (!optRt || !needsTargetDefaults) {
      return
    }

    // the runtime remains canonical scenario state. only the optimizer's
    // resonator-specific inputs are re-instantiated for the new subject.
    updOptSets(() => optSets, optResId)
    setEchoPlanS({ resonatorId: optResId, plans: mkMptyEchoPl() })
    clearRun()
  }, [clearRun, needsTargetDefaults, optResId, optRt, optSets, updOptSets])

  const openUiModal = useCallback((content: ReactNode) => {
    uiModal.show(content)
  }, [uiModal])

  const closeUiModal = () => {
    uiModal.hide()
  }

  const openRlsMdl = () => {
    rulesModal.show()
  }

  const clsRlsMdl = () => {
    rulesModal.hide()
  }

  const trgtSkll = useMemo(
    () => (effectRuntime ? listOptTrgt(effectRuntime) : []),
    [effectRuntime],
  )

  const skillOptions = useMemo<SelectOption<string>[]>(() => {
    return trgtSkll.map((skill) => ({
      value: skill.id,
      label: skill.label,
    }))
  }, [trgtSkll])

  const skillGroups = useMemo<SelectGroup<string>[]>(() => {
    const grouped = new Map<string, SelectOption<string>[]>()

    for (const skill of trgtSkll) {
      const existing = grouped.get(skill.tab) ?? []
      existing.push({
        value: skill.id,
        label: skill.label,
      })
      grouped.set(skill.tab, existing)
    }

    // group order follows the shared skill-tab order.
    return OPT_SKILL_TABS
      .map((tab) => ({
        label: getSkillTabLabel(tab),
        options: grouped.get(tab) ?? [],
      }))
      .filter((group) => group.options.length > 0)
  }, [trgtSkll])

  const skillColors = useMemo(
    () => new Map(trgtSkll.map((skill) => [skill.id, skillDisplayColor(skill)])),
    [trgtSkll],
  )

  // target skill is an optimizer preference, while the available target list
  // belongs to the current canonical runtime. a resonator/scenario switch can
  // therefore leave the persisted preference pointing at the previous
  // resonator for one render. resolve the effective value synchronously so no
  // consumer can observe an impossible runtime/skill pair.
  const targetSkillId = trgtSkll.some((skill) => skill.id === optSets.targetSkillId)
    ? optSets.targetSkillId
    : trgtSkll[0]?.id ?? null

  const comboOptions: SelectOption[] = useMemo(
    () => effectRuntime
      ? listRotationDamageSources(scenario, savedRotations, optResId, liveScenarios).map((option) => ({
        value: option.id,
        label: option.label,
      }))
      : [],
    [effectRuntime, scenario, savedRotations, optResId, liveScenarios],
  )

  const pendingSavedSource = !savedRotationsHydrated && optSets.targetComboSourceId?.startsWith('saved:')
  const rotationSource = useMemo(
    () => pendingSavedSource
      ? null
      : resolveRotationDamageSource(optSets.targetComboSourceId, scenario, savedRotations, optResId, liveScenarios),
    [optSets.targetComboSourceId, scenario, savedRotations, optResId, liveScenarios, pendingSavedSource],
  )
  const comboAvailable = Boolean(effectRuntime && rotationSource)
  const sourceDataReady = useResonatorData(rotationMode
    ? rotationSource?.savedTeamContext?.team.members.map((member) => member.resonatorId) ?? []
    : [])
  const savedRotationContext = useMemo(
    () => rotationMode && effectRuntime && sourceDataReady ? rotationDamageContext(rotationSource, scenario, effectRuntime) : null,
    [rotationMode, effectRuntime, rotationSource, scenario, sourceDataReady],
  )
  const scenarioCombatSetup = useMemo(() => rotationCombatSetup(scenario), [scenario])
  const scoringRuntime = savedRotationContext?.runtime ?? effectRuntime
  const scoringParticipants = savedRotationContext?.runtimesById ?? effectRuntimesById
  const scoringTargets = savedRotationContext?.selectedTargets ?? activeTarget
  const scoringSetup = rotationMode
    ? savedRotationContext?.combatSetup ?? scenarioCombatSetup
    : undefined
  const previousSource = useRef<{
    id: string
    program: unknown
    team: unknown
    environment: unknown
    initialOnFieldMemberId: unknown
    setConditionals: string
    enemy: unknown
    teammates: readonly unknown[]
  } | null>(null)
  useLytFfct(() => {
    const saved = rotationSource?.id.startsWith('saved:')
      ? savedRotations.find((entry) => `saved:${entry.id}` === rotationSource.id)
      : null
    const live = rotationSource?.id.startsWith('scenario:')
      ? liveScenarios.find((entry) => `scenario:${entry.id}` === rotationSource.id)
      : null
    const next = rotationMode && rotationSource ? {
      id: rotationSource.id,
      program: saved?.scenario.program.program ?? live?.program.program
        ?? (rotationSource.id === 'live' ? scenario.program.program : null),
      team: rotationSource.savedTeamContext?.team ?? null,
      environment: rotationSource.savedTeamContext?.environment ?? scenario.environment,
      initialOnFieldMemberId: rotationSource.savedTeamContext?.initialOnFieldMemberId ?? null,
      setConditionals: JSON.stringify(optSetConds.off),
      enemy: enemyProfile,
      teammates: rotationSource.savedTeamContext ? [] : scenario.team.members
        .filter((member) => member.id !== optimizerMember.id),
    } : null
    const previous = previousSource.current
    if (previous && next && (
      previous.id !== next.id || previous.program !== next.program
      || previous.team !== next.team || previous.environment !== next.environment
      || previous.initialOnFieldMemberId !== next.initialOnFieldMemberId
      || previous.setConditionals !== next.setConditionals || previous.enemy !== next.enemy
      || previous.teammates.length !== next.teammates.length
      || previous.teammates.some((member, index) => member !== next.teammates[index])
    )) clearRun()
    previousSource.current = next
  }, [rotationMode, rotationSource, scenario.program.program, scenario.environment,
    scenario.team.members, savedRotations, liveScenarios, optSetConds, enemyProfile, optimizerMember.id, clearRun])

  useEffect(() => {
    if (rotationMode && !comboAvailable && !pendingSavedSource) {
      updOptSets((settings) => ({
        ...settings,
        targetMode: 'skill',
        rotationMode: false,
      }))
    }
  }, [rotationMode, comboAvailable, pendingSavedSource, updOptSets])

  const selRotTms: RotationNode[] | null = rotationSource?.items ?? null

  useEffect(() => {
    if (!savedRotationsHydrated && optSets.targetComboSourceId?.startsWith('saved:')) return
    const hasSelCmb = optSets.targetComboSourceId
      ? comboOptions.some((option) => option.value === optSets.targetComboSourceId)
      : false

    if (hasSelCmb) {
      return
    }

    const nextTgtCmbId = comboOptions[0]?.value ?? null
    if (optSets.targetComboSourceId === nextTgtCmbId) {
      return
    }

    updOptSets((settings) => ({
      ...settings,
      targetComboSourceId: nextTgtCmbId,
    }))
  }, [comboOptions, optSets, savedRotationsHydrated, updOptSets])

  const needsInventory = !isThryMode || optInvMdl.visible
  const optProfiles = useAppStore((state) => needsInventory && optSets.excludeEquipped ? selScenarioProfiles(state) : null)
  const optInvEchoSg = useMemo(() => optProfiles ? indexEquippedEchoes(optProfiles) : {}, [optProfiles])
  const optBaseInvEchoE = useMemo(() => {
    if (!needsInventory) return []

    if (!optSets.excludeEquipped) {
      return invEchoEnts
    }

    return invEchoEnts.filter(({ echo }) => {
      const owners = optInvEchoSg[echo.uid] ?? []
      return !owners.some((owner) => owner.resonatorId !== optResId)
    })
  }, [invEchoEnts, needsInventory, optInvEchoSg, optResId, optSets.excludeEquipped])

  const fltrRuleEcho = useMemo(() => {
    const llwdSetIds = optSetIdSet(optSets.allowedSets)
    const llwdMainStat = new Set(
      optSets.mainStatFilter
        .map((key) => mapMainStatF(key, optSets.selectedBonus))
        .filter((value): value is string => Boolean(value)),
    )

    return optBaseInvEchoE.filter(({ echo }) => {
      if (llwdSetIds.size > 0 && !llwdSetIds.has(echo.set)) {
        return false
      }
      return !(llwdMainStat.size > 0 && !llwdMainStat.has(echo.mainStats.primary.key));
    })
  }, [optBaseInvEchoE, optSets.allowedSets, optSets.mainStatFilter, optSets.selectedBonus])

  const allEchoes = useMemo(() => listEchoes(), [])

  const thryMFltr = useMemo(() => {
    if (!isThryMode || !effectRuntime) {
      return {
        mainStatFilter: [],
        selectedBonus: null,
      }
    }

    const ntlSets = deriveOptSets({
      runtime: effectRuntime,
      runtimesById: effectRuntimesById,
      enemy: enemyProfile,
      selectedTargets: activeTarget,
    })

    return {
      mainStatFilter: [...(ntlSets.mainStatFilter ?? [])],
      selectedBonus: ntlSets.selectedBonus ?? null,
    }
  }, [isThryMode, activeTarget, effectRuntime, effectRuntimesById, enemyProfile])

  const runOptSets = useMemo(() => {
    if (!isThryMode && targetSkillId === optSets.targetSkillId) {
      return optSets
    }

    return {
      ...optSets,
      targetSkillId,
      ...(isThryMode
        ? {
            mainStatFilter: thryMFltr.mainStatFilter,
            selectedBonus: thryMFltr.selectedBonus,
          }
        : {}),
    }
  }, [isThryMode, optSets, targetSkillId, thryMFltr])

  const prepTgtSkll = useMemo(() => {
    const resonatorId = optResId
    const tgtSkllId = targetSkillId
    if (
      !needsInventory || optSets.keepPercent <= 0 ||
      !resonatorId ||
      !effectRuntime ||
      !tgtSkllId ||
      rotationMode
    ) {
      return null
    }

    return compOptTgtCt({
      runtime: effectRuntime,
      resonatorId,
      skillId: tgtSkllId,
      enemy: enemyProfile,
      runtimesById: makeRuntimeMap(effectRuntime, effectRuntimesById),
      selectedTargets: activeTarget,
    })
  }, [
    needsInventory, optSets.keepPercent,
    activeTarget,
    effectRuntime,
    effectRuntimesById,
    enemyProfile,
    optResId,
    rotationMode,
    targetSkillId,
  ])

  const optWghtMap = useMemo(() => {
    if (
      !effectRuntime ||
      rotationMode ||
      !prepTgtSkll
    ) {
      return null
    }

    // stat weights are derived from the live runtime so filters and result
    // scoring stay consistent with the current build and target context.
    return makeStatWeights({
      finalStats: prepTgtSkll.combat.finalStats,
      skill: prepTgtSkll.skill,
      enemy: enemyProfile,
      level: effectRuntime.base.level,
      combat: effectRuntime.state.combat,
    })
  }, [effectRuntime, enemyProfile, prepTgtSkll, rotationMode])

  const optEligibleInvEchoE = useMemo(() => {
    if (!needsInventory || optSets.keepPercent <= 0 || optSets.rotationMode || !optWghtMap) return fltrRuleEcho
    const fltrChs = applyKeepPrc(
      fltrRuleEcho.map((entry) => entry.echo),
      {
        keepPercent: optSets.keepPercent,
        rotationMode: optSets.rotationMode,
        lockedMainId: optSets.lockedMainEchoId,
        weights: optWghtMap,
      },
    )

    const entriesByUid = new Map(
      fltrRuleEcho.map((entry) => [entry.echo.uid, entry] as const),
    )

    return fltrChs
      .map((echo) => entriesByUid.get(echo.uid) ?? null)
      .filter((entry): entry is (typeof fltrRuleEcho)[number] => Boolean(entry))
  }, [needsInventory, fltrRuleEcho, optSets.keepPercent, optSets.rotationMode, optSets.lockedMainEchoId, optWghtMap])

  const fltrInvEchoE = useMemo(() => {
    if (isThryMode) {
      return optEligibleInvEchoE
    }

    const trackedUids = new Set(optInvSelection.echoUids)
    if (optInvSelection.mode === 'include') {
      return optEligibleInvEchoE.filter(({ echo }) => echo.uid && trackedUids.has(echo.uid))
    }

    if (trackedUids.size === 0) {
      return optEligibleInvEchoE
    }

    return optEligibleInvEchoE.filter(({ echo }) => !echo.uid || !trackedUids.has(echo.uid))
  }, [isThryMode, optEligibleInvEchoE, optInvSelection])

  const fltrComboChs = useMemo(
    () => fltrInvEchoE.map((entry) => entry.echo),
    [fltrInvEchoE],
  )

  const qppdChs = useMemo(
    () => normEchoLdt(effectRuntime?.build.echoes ?? []).filter(
      (echo): echo is EchoInstance => echo != null,
    ),
    [effectRuntime],
  )

  const shldCntCombo = fltrComboChs.length >= 5
  const rslvComboCnt = useMemo(() => {
    if (isThryMode) {
      if (
        !effectRuntime ||
        (!rotationMode && !runOptSets.targetSkillId) ||
        qppdChs.length === 0
      ) {
        return 0
      }

      return countTheory(runOptSets, effectRuntime)
    }

    if (!shldCntCombo) {
      return 0
    }

    return countOptCombos(
      fltrComboChs,
      optSets.lockedMainEchoId,
      optSets.enableGpu ? 'combinadic' : 'rows',
    )
  }, [
    fltrComboChs,
    effectRuntime,
    isThryMode,
    optSets.enableGpu,
    optSets.lockedMainEchoId,
    runOptSets,
    qppdChs.length,
    rotationMode,
    shldCntCombo,
  ])

  const bslnInput = useMemo<OptBaselineInput | null>(() => {
    if (
      (rotationMode && (!rotationSource || !sourceDataReady)) ||
      !effectRuntime ||
      (!rotationMode && !targetSkillId) ||
      qppdChs.length === 0
    ) {
      return null
    }

    return {
      scenarioId: scenario.id,
      memberId: optimizerMember.id,
      resonatorId: optResId,
      resSeed: seedRsntById[optResId],
      gameDataMode: getGameDataMode(),
      runtime: scoringRuntime ?? effectRuntime,
      runtimesById: scoringParticipants,
      settings: {
        rotationMode,
        targetSkillId,
      },
      invChs: qppdChs,
      enemyProfile,
      selectedTargets: scoringTargets,
      combatSetup: scoringSetup,
      setConds: optSetConds,
      rotTms: rotationMode ? selRotTms : undefined,
    }
  }, [
    enemyProfile,
    qppdChs,
    optResId,
    optimizerMember.id,
    scenario.id,
    effectRuntime,
    scoringRuntime,
    scoringParticipants,
    scoringTargets,
    scoringSetup,
    rotationSource,
    sourceDataReady,
    optSetConds,
    targetSkillId,
    rotationMode,
    selRotTms,
  ])

  const [baselineEvaluation, setBaselineEvaluation] = useState<{
    input: WeakRef<OptBaselineInput>
    result: { damage: number; stats: OptResultStats | null } | null
  } | null>(null)

  useEffect(() => {
    if (!bslnInput || qppdChs.length === 0) return undefined
    let disposed = false
    let worker: Worker | null = null
    const mainIndex = Math.max(0, qppdChs.findIndex((echo) => echo.mainEcho))
    const timer = window.setTimeout(() => {
      if (disposed) return
      worker = new Worker(
        new URL('@/engine/optimizer/workers/compile.worker.ts', import.meta.url),
        { type: 'module' },
      )
      worker.onmessage = (event: MessageEvent<OptCompOutMs>) => {
        const message = event.data
        if (message.type !== 'baselineDone' || disposed) return
        setBaselineEvaluation({ input: new WeakRef(bslnInput), result: message.result })
        worker?.terminate()
        worker = null
      }
      worker.onerror = () => {
        worker?.terminate()
        worker = null
      }
      worker.postMessage({
        type: 'baseline',
        runId: 1,
        payload: bslnInput,
        mainIndex,
      })
    }, 160)

    return () => {
      disposed = true
      window.clearTimeout(timer)
      worker?.terminate()
    }
  }, [bslnInput, qppdChs])

  const bslnVltn = baselineEvaluation?.input.deref() === bslnInput
    ? baselineEvaluation.result
    : null

  const baseResult = useMemo<OptDisplayRow>(() => {
    const displayRuntime = effectRuntime
    if (!displayRuntime) {
      return plchRslt()
    }

    const summary = smmrEchoLdt(displayRuntime.build.echoes)
    const baseWeapon = displayRuntime.build.weapon.id
      ? getWpnById(displayRuntime.build.weapon.id)
      : null

    return {
      damage: bslnVltn?.damage ?? 0,
      costs: summary.costs,
      sets: summary.sets,
      mainEchoIcon: summary.mainEchoIcon,
      weaponIcon: baseWeapon?.icon ?? null,
      weaponName: baseWeapon?.name ?? null,
      stats: bslnVltn?.stats ?? null,
    }
  }, [effectRuntime, bslnVltn])

  const invChsByUid = useMemo(
    () => new Map(optResults.some((result) => 'uids' in result && !('echoes' in result)) ? invEchoEnts.map((entry) => [entry.echo.uid, entry.echo] as const) : []),
    [invEchoEnts, optResults],
  )

  const rsltsPerPage = 32

  const needsFacets = optToolsOpen || !isDefaultViewCriteria(viewCriteria) || findPreds.length > 0
  const facetStats = viewNeedsStats(viewCriteria, findPreds)
  useEffect(() => {
    if (!needsFacets || optResults.length === 0) {
      setFacetTable(null)
      return
    }

    setFacetTable(null)

    let cncl = false
    const total = optResults.length
    const next = new ResultFacetTable(total)
    const chunkSize = 768
    let start = 0
    let tid: ReturnType<typeof setTimeout> | null = null

    const step = () => {
      if (cncl) {
        return
      }

      const end = Math.min(start + chunkSize, total)
      const slice = buildFacetSlice({
        optResults,
        start,
        end,
        invChsByUid,
        optResultEchoes,
        optResultData,
        withStats: facetStats,
      })

      for (let index = 0; index < slice.length; index += 1) {
        next.set(start + index, slice[index]!)
      }

      start = end
      if (start < total) {
        tid = setTimeout(step, 0)
        return
      }

      setFacetTable(next)
    }

    tid = setTimeout(step, 0)

    return () => {
      cncl = true
      if (tid) {
        clearTimeout(tid)
      }
    }
  }, [needsFacets, facetStats, optResults, invChsByUid, optResultEchoes, optResultData])

  const viewIndices = useMemo<number[] | null>(() => {
    if (!facetTable || isDefaultViewCriteria(viewCriteria)) {
      return null
    }
    return buildResultView(facetTable, viewCriteria)
  }, [facetTable, viewCriteria])

  // reverse lookup (original index -> display position) so the selected/preview
  // row can be located within the current view.
  const dispPosOf = (origIndex: number): number =>
    viewIndices ? viewIndices.indexOf(origIndex) : origIndex

  const resultLength = viewIndices ? viewIndices.length : optResults.length
  const totalPages = Math.max(1, Math.ceil(resultLength / rsltsPerPage))
  const pageStart = pageIndex * rsltsPerPage
  const pageEnd = pageStart + rsltsPerPage

  // original result indices for the rows on the current page.
  const pageOrigIndices = useMemo<number[]>(() => {
    const out: number[] = []
    const end = Math.min(pageEnd, resultLength)
    for (let pos = pageStart; pos < end; pos += 1) {
      const orig = viewIndices ? viewIndices[pos] : pos
      if (orig != null && orig >= 0) {
        out.push(orig)
      }
    }
    return out
  }, [viewIndices, pageStart, pageEnd, resultLength])

  const rows = useMemo<OptDisplayRow[]>(() => {
    return getRowsAt({
      optResults: optResults,
      indices: pageOrigIndices,
      invChsByUid: invChsByUid,
      optResultEchoes: optResultEchoes,
      optResultData: optResultData,
    })
  }, [invChsByUid, optResults, optResultData, optResultEchoes, pageOrigIndices])

  // display positions in the current view satisfying the find predicates: the
  // rows the jump steps through (without hiding anything).
  const findMatches = useMemo<number[]>(() => {
    if (findPreds.length === 0 || !facetTable) {
      return []
    }
    const len = viewIndices ? viewIndices.length : optResults.length
    const out: number[] = []
    for (let pos = 0; pos < len; pos += 1) {
      const orig = viewIndices ? viewIndices[pos] : pos
      const facet = orig != null ? facetTable.get(orig) : undefined
      if (facet && facetMatches(facet, findPreds)) {
        out.push(pos)
      }
    }
    return out
  }, [findPreds, facetTable, viewIndices, optResults.length])

  // 1-based position of the current match within the run, 0 when none active.
  const findMatchIndex = useMemo(() => {
    const at = findMatches.indexOf(findPos)
    return at >= 0 ? at + 1 : 0
  }, [findMatches, findPos])

  const jumpToFind = useCallback((pos: number) => {
    setFindPos(pos)
    setPageIndex(Math.floor(pos / rsltsPerPage))
    const orig = viewIndices ? viewIndices[pos] : pos
    if (orig != null && orig >= 0) {
      setPrvwTrgt({ kind: 'result', index: orig })
    }
  }, [viewIndices])

  const onFindStep = useCallback((dir: 1 | -1) => {
    if (findMatches.length === 0) {
      return
    }
    let next: number | undefined
    if (dir === 1) {
      next = findMatches.find((pos) => pos > findPos) ?? findMatches[0]
    } else {
      for (let i = findMatches.length - 1; i >= 0; i -= 1) {
        if (findMatches[i] < findPos) {
          next = findMatches[i]
          break
        }
      }
      next ??= findMatches[findMatches.length - 1]
    }
    jumpToFind(next)
  }, [findMatches, findPos, jumpToFind])

  // search from the current page and wrap to the first match if needed.
  const onFindPreds = useCallback((preds: Predicate[]) => {
    setFindPreds(preds)
    setFindPos(pageStart - 1)
  }, [pageStart])

  useEffect(() => {
    if (findPreds.length === 0 || findMatches.length === 0) {
      return
    }
    if (findMatches.includes(findPos)) {
      return
    }
    jumpToFind(findMatches.find((pos) => pos > findPos) ?? findMatches[0])
  }, [findPreds, findMatches, findPos, jumpToFind])
  const rslvPrvwTgt = useMemo<PrvwTgt>(() => {
    if (prvwTrgt.kind === 'result' && !optResults[prvwTrgt.index]) {
      return { kind: 'base' }
    }

    return prvwTrgt
  }, [optResults, prvwTrgt])
  const selPrvwDispPos = rslvPrvwTgt.kind === 'result'
    ? dispPosOf(rslvPrvwTgt.index)
    : -1
  const selPrvwNdx = (
    selPrvwDispPos >= pageStart &&
    selPrvwDispPos < pageEnd
  )
    ? selPrvwDispPos - pageStart
    : null

  // drop a stale filter/sort when a new run clears the results.
  const noResults = optResults.length === 0
  useEffect(() => {
    if (noResults) {
      setViewCriteria(DEFAULT_VIEW_CRITERIA)
      setFindPreds([])
      setFindPos(-1)
    }
  }, [noResults])

  // keep the page in range when filtering shrinks the view below the cursor.
  useEffect(() => {
    if (pageIndex > totalPages - 1) {
      setPageIndex(Math.max(0, totalPages - 1))
    }
  }, [pageIndex, totalPages])

  const applyViewCriteria = useCallback((next: ResultViewCriteria) => {
    setViewCriteria(next)
    setPageIndex(0)
  }, [])

  const echoes = useMemo(() => {
    return getPreview({
      optResults: optResults,
      rslvPrvwIdx: rslvPrvwTgt.kind === 'result' ? rslvPrvwTgt.index : null,
      invChsByUid: invChsByUid,
      optResultEchoes: optResultEchoes,
      optResultData: optResultData,
      fllbChs: effectRuntime?.build.echoes ?? [],
    })
  }, [
    invChsByUid,
    optResultEchoes,
    optResultData,
    optResults,
    effectRuntime,
    rslvPrvwTgt,
  ])

  const showBasePrvw = useCallback(() => {
    setPrvwTrgt({ kind: 'base' })
  }, [])

  // resolve the searched weapon for a result, if weapon search produced one.
  // raw theory results store a weaponIds index; materialized results store the ID.
  function rsltWeaponId(index: number): string | null {
    const entry = optResults[index] as
      | { weaponId?: string; weapon?: number }
      | undefined
    if (!entry) {
      return null
    }
    if (typeof entry.weaponId === 'string' && entry.weaponId) {
      return entry.weaponId
    }
    const ids = optResultData && 'weaponIds' in optResultData
      ? (optResultData as { weaponIds?: string[] }).weaponIds
      : undefined
    if (typeof entry.weapon === 'number' && entry.weapon >= 0 && Array.isArray(ids)) {
      return ids[entry.weapon] ?? null
    }
    return null
  }

  function equipPreviewLoadout(
    nextEchoes: Array<EchoInstance | null>,
    resultIndex: number | null,
  ) {
    const weaponId = resultIndex == null ? null : rsltWeaponId(resultIndex)

    // a preview is detached until this explicit commit. clone it once more at
    // the boundary so later local edits cannot share objects with live state.
    updateScenarioRuntime((runtime) => withRsltLoadout(
      runtime,
      cloneEchoLoadout(nextEchoes),
      weaponId ? weaponEquipState(weaponId, runtime.build.weapon.level, weaponSuggests) : null,
    ))
  }

  function applyOptRslt(index: number) {
    const nextEchoes = rsltLdt({
      optResults: optResults,
      index,
      invChsByUid: invChsByUid,
      optResultEchoes: optResultEchoes,
      optResultData: optResultData,
    })
    if (nextEchoes.every((echo) => echo == null)) {
      return
    }

    equipPreviewLoadout(nextEchoes, index)
  }

  const showRsltPrvw = useCallback((index: number) => {
    const orig = viewIndices ? viewIndices[pageStart + index] ?? -1 : pageStart + index
    if (orig >= 0) setPrvwTrgt({ kind: 'result', index: orig })
  }, [pageStart, viewIndices])

  const showWeapon = isThryMode && optSets.includeWeapons

  const vsblHdrTtls = useMemo(() => {
    const base = rotationMode
      ? HEADER_TITLES.filter((title) => title !== 'Ʃ AMP%')
      : HEADER_TITLES
    if (!showWeapon) {
      return base
    }
    // insert the weapon column right after "Main", mirroring the row layout
    const mainIdx = base.indexOf('Main')
    const at = mainIdx >= 0 ? mainIdx + 1 : 1
    return [...base.slice(0, at), 'Weapon', ...base.slice(at)]
  }, [rotationMode, showWeapon])

  const pageItems = useMemo(() => {
    const items: Array<number | string> = []
    if (totalPages <= 10) {
      for (let i = 0; i < totalPages; i += 1) {
        items.push(i)
      }
      return items
    }
    if (pageIndex < 7) {
      for (let i = 0; i < 7; i += 1) {
        items.push(i)
      }
      items.push('...')
      items.push(totalPages - 1)
      return items
    }
    if (pageIndex > totalPages - 8) {
      items.push(0)
      items.push('...')
      for (let i = totalPages - 7; i < totalPages; i += 1) {
        items.push(i)
      }
      return items
    }
    items.push(0)
    items.push('...')
    for (let i = pageIndex - 2; i <= pageIndex + 2; i += 1) {
      items.push(i)
    }
    items.push('...')
    items.push(totalPages - 1)
    return items
  }, [pageIndex, totalPages])

  const openJump = useCallback((index: number) => {
    setJumpEditNdx(index)
    setJumpDraft('')
    requestAnimationFrame(() => {
      const node = jumpInputRef.current
      if (node) {
        node.focus()
        node.select()
      }
    })
  }, [])

  const closeJump = useCallback(() => {
    setJumpEditNdx(null)
    setJumpDraft('')
  }, [])

  const commitJump = useCallback(() => {
    const parsed = Number.parseInt(jumpDraft, 10)
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= totalPages) {
      setPageIndex(parsed - 1)
    }
    closeJump()
  }, [jumpDraft, totalPages, closeJump])

  // close the jumper whenever the page set changes underneath it.
  useEffect(() => {
    if (jumpEditNdx != null && jumpEditNdx >= pageItems.length) {
      closeJump()
    }
  }, [pageItems, jumpEditNdx, closeJump])

  const selMainEchoF = useMemo(() => {
    const echoId = optSets.lockedMainEchoId
    if (!echoId) {
      return null
    }

    const echo = getEchoById(echoId)
    if (!echo) {
      return null
    }

    return {
      id: echo.id,
      name: echo.name,
      icon: echo.icon,
    }
  }, [optSets.lockedMainEchoId])

  const openMainEcho = (target: OpEchoTarget = 'filter') => {
    mainEchoPckr.show(target)
  }

  const clsMainEchoP = () => {
    mainEchoPckr.hide(mainEchoSession.finish)
  }

  const mainEchoPiece = mainEchoPckr.value ?? 'filter'
  const selMainEchoI = mainEchoPiece === 'filter'
    ? mainEchoSession.draft.lockedMainEchoId
    : rslvEchoPlns[mainEchoPiece]?.mainEchoId ?? null

  const isLoading = optStts === 'running'
  const success = optStts === 'done'
  const cancelled = optStts === 'cancelled'

  const onRunOpt = useCallback(() => {
    if ((rotationMode && (!rotationSource || !sourceDataReady)) || !optRt) {
      return
    }

    if (!runOptSets.enableGpu && !optCpuHintSe) {
      setOptCpuHin(true)
      openUiModal(modalContent.firstTimeOptimizer)
      return
    }

    setPageIndex(0)
    showBasePrvw()
    setProgress(mkMptyPrgr())
    const launchSearch = () => startOpt({
      scenarioId: scenario.id,
      memberId: optimizerMember.id,
      resonatorId: optResId,
      resSeed: seedRsntById[optResId],
      gameDataMode: getGameDataMode(),
      runtime: scoringRuntime ?? optRt,
      runtimesById: scoringParticipants,
      settings: runOptSets,
      invChs: fltrInvEchoE.map((entry) => entry.echo),
      enemyProfile,
      selectedTargets: scoringTargets,
      combatSetup: scoringSetup,
      setConds: optSetConds,
      rotTms: selRotTms,
      weaponPlan: weaponSuggests,
    }, {
      onProgress: (nextProgress) => {
        setProgress(nextProgress)
      },
      settle: () => settleBand(bandRef.current),
    })

    // an empty build has no baseline to score, so the search starts right away
    if (rotationMode && bslnInput) {
      setBaselineEvaluation(null)
      let baselineWorker: Worker | null = new Worker(
        new URL('@/engine/optimizer/workers/compile.worker.ts', import.meta.url),
        { type: 'module' },
      )
      baselineWorker.onmessage = (event: MessageEvent<OptCompOutMs>) => {
        const message = event.data
        if (message.type !== 'baselineDone') return
        setBaselineEvaluation({ input: new WeakRef(bslnInput), result: message.result })
        baselineWorker?.terminate()
        baselineWorker = null
        launchSearch()
      }
      baselineWorker.onerror = () => {
        baselineWorker?.terminate()
        baselineWorker = null
        launchSearch()
      }
      baselineWorker.postMessage({
        type: 'baseline',
        runId: Date.now(),
        payload: bslnInput,
        mainIndex: Math.max(0, qppdChs.findIndex((echo) => echo.mainEcho)),
      })
      return
    }

    launchSearch()
  }, [
    bslnInput,
    enemyProfile,
    scoringRuntime,
    scoringParticipants,
    scoringTargets,
    scoringSetup,
    rotationSource,
    sourceDataReady,
    fltrInvEchoE,
    openUiModal,
    optCpuHintSe,
    optSetConds,
    optResId,
    optRt,
    optimizerMember.id,
    runOptSets,
    qppdChs,
    rotationMode,
    scenario.id,
    selRotTms,
    setOptCpuHin,
    setProgress,
    showBasePrvw,
    startOpt,
    weaponSuggests,
  ])

  const handleHalt = useCallback(() => {
    cnclOpt()
  }, [cnclOpt])

  const resultToolbar = !isLoading && optResults.length > 0 ? (
      <ResultToolbar
        open={optToolsOpen}
        onToggle={setOptToolsOpen}
        mode={consoleMode}
        onMode={setConsoleMode}
        facets={facetTable}
        criteria={viewCriteria}
        onCriteria={applyViewCriteria}
        matchCount={resultLength}
        totalCount={optResults.length}
        findPreds={findPreds}
        onFindPreds={onFindPreds}
        findMatchIndex={findMatchIndex}
        findMatchCount={findMatches.length}
      onFindStep={onFindStep}
    />
  ) : null

  const resultsTable = (
    <div className="results-container" data-mode={targetMode} data-weapon={showWeapon ? '1' : undefined}>
        <div
          className={`opt-results-header${rslvPrvwTgt.kind === 'base' ? ' is-selected' : ''}`}
          onClick={showBasePrvw}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              showBasePrvw()
            }
          }}
          role="button"
          tabIndex={0}
        >
          <div className="opt-results-header__titles" data-mode={targetMode}>
            {vsblHdrTtls.map((title) => (
              <div key={title} className="opt-results-header__col">
                {title}
              </div>
            ))}
          </div>
          <Row
            result={baseResult}
            base
            baseDamage={baseResult.damage}
            rotationMode={rotationMode}
            showWeapon={showWeapon}
            onClick={showBasePrvw}
          />
        </div>

        <div className={`optimizer-results app-loader-host ${isLoading ? 'running' : ''}`}>
          {isLoading ? (
            <AppLdrVrly text="Optimizing..." />
          ) : (
            <>
              <OptimizerResultRows rows={rows} indices={pageOrigIndices} selected={selPrvwNdx}
                baseDamage={baseResult.damage} rotationMode={rotationMode} showWeapon={showWeapon}
                onSelect={showRsltPrvw} onEquip={applyOptRslt} />

              {optRrr ? (
                <div className="opt-result-row is-base">
                  <div className="opt-result-row__col">{optRrr}</div>
                </div>
              ) : null}

              {totalPages > 1 ? (
                <div className="opt-pagination">
                  <button className="opt-pagination__btn opt-pagination__btn--subtle"
                    disabled={pageIndex === 0}
                    onClick={() => {
                      setPageIndex((value) => Math.max(0, value - 1))
                    }}
                  >
                    ‹
                  </button>

                  {pageItems.map((item, index) =>
                    item === '...' ? (
                      jumpEditNdx === index ? (
                        <input
                          key={`jump-${index}`}
                          ref={jumpInputRef} className="opt-pagination__jump"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          aria-label={`Jump to page (1 to ${totalPages})`}
                          placeholder={`1–${totalPages}`}
                          value={jumpDraft}
                          onChange={(event) => {
                            const next = event.target.value.replace(/[^0-9]/g, '')
                            setJumpDraft(next)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              commitJump()
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              closeJump()
                            }
                          }}
                          onBlur={() => {
                            // blur cancels an empty draft and commits a populated one.
                            if (jumpDraft.length === 0) {
                              closeJump()
                            } else {
                              commitJump()
                            }
                          }}
                        />
                      ) : (
                        <button
                          key={`ellipsis-${index}`}
                          type="button" className="opt-pagination__ellipsis"
                          aria-label={`Jump to page (1 to ${totalPages})`}
                          title="Jump to page"
                          onClick={() => openJump(index)}
                        >
                          <span className="opt-pagination__ellipsis-dots" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </span>
                        </button>
                      )
                    ) : (
                      <button
                        key={item}
                        className={`opt-pagination__btn${item === pageIndex ? ' is-active' : ''}`}
                        onClick={() => {
                          setPageIndex(item as number)
                        }}
                      >
                        {(item as number) + 1}
                      </button>
                    ),
                  )}

                  <button className="opt-pagination__btn opt-pagination__btn--subtle"
                    disabled={pageIndex >= totalPages - 1}
                    onClick={() => {
                      setPageIndex((value) => Math.min(totalPages - 1, value + 1))
                    }}
                  >
                    ›
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
  )

  const labEditable = !isLoading
  const previewKey = rslvPrvwTgt.kind === 'result'
    ? `${optResId}:result:${rslvPrvwTgt.index}`
    : `${optResId}:base`

  // theory search obtains its exact candidate count from worker progress,
  // unlike inventory mode's precomputed combination count.
  const stagePermutations = isThryMode
    ? null
    : shldCntCombo
      ? rslvComboCnt.toLocaleString()
      : '0'

  const resultsOnBoard = !isLoading && optResults.length > 0

  const labSurface = (
    <OptimizerLab
      resonatorId={optResId}
      resonatorName={displayName}
      runtime={effectRuntime}
      previewKey={previewKey}
      previewEchoes={echoes}
      bandFolded={resultsOnBoard}
      bandRef={bandRef}
      editable={labEditable}
      onEquipPreview={(previewEchoes) => equipPreviewLoadout(
        previewEchoes,
        rslvPrvwTgt.kind === 'result' ? rslvPrvwTgt.index : null,
      )}
    >
      <ContextTrigger
        asChild
        ariaLabel="Optimizer actions"
        location="optimizer.surface"
        context={{
          running: isLoading,
          pending: isThryMode,
          hasResults: resultsOnBoard,
          run: onRunOpt,
          halt: handleHalt,
          clear: clearRun,
          openInventory: optInvMdl.show,
          openRules: openRlsMdl,
        }}
      >
      <div className="opb-surface rte-scope">
        {resultsOnBoard ? (
          <div className="opb-results">
            {resultToolbar}
            {resultsTable}
          </div>
        ) : (
          <OptStage
            isLoading={isLoading}
            progressSource={progressSource}
            cancelled={cancelled}
            success={success}
            permutations={stagePermutations}
            batchSize={optBtchSize}
            isTheory={isThryMode}
            resultCount={resultLength}
          />
        )}

        <OptTransport
          isLoading={isLoading}
          progressSource={progressSource}
          cancelled={cancelled}
          success={success}
          echoCount={isThryMode ? qppdChs.length : fltrInvEchoE.length}
          resultCount={resultLength}
          batchSize={optBtchSize}
          searchMode={optMode}
          targetMode={targetMode}
          comboAvailable={comboAvailable}
          skillOptions={skillOptions}
          skillGroups={skillGroups}
          skillColors={skillColors}
          comboOptions={comboOptions}
          targetSkillId={targetSkillId}
          targetComboId={optSets.targetComboSourceId}
          mainEcho={selMainEchoF}
          allowedSets={optSets.allowedSets}
          mainStatFilter={isThryMode ? thryMFltr.mainStatFilter : optSets.mainStatFilter}
          selectedBonus={isThryMode ? thryMFltr.selectedBonus : optSets.selectedBonus}
          excludeEquipped={optSets.excludeEquipped}
          includeWeapons={optSets.includeWeapons}
          keepPercent={optSets.keepPercent}
          inventoryExcluded={optInvSelection.echoUids.length}
          inventoryMode={optInvSelection.mode}
          setConds={optSetConds}
          weaponPlan={weaponSuggests}
          statConstraints={optSets.statConstraints}
          resultsLimit={optSets.resultsLimit}
          enableGpu={optSets.enableGpu}
          lowMemoryMode={optSets.lowMemoryMode}
          onRun={onRunOpt}
          onHalt={handleHalt}
          onClear={clearRun}
          onConfig={(config) => {
            const nextRotationMode = config.targetMode === 'combo'
            updOptSets((settings) => ({
              ...settings,
              ...config,
              rotationMode: nextRotationMode,
            }))
            if (rotationMode !== nextRotationMode) clearRun()
          }}
          onOpenMainEcho={() => openMainEcho()}
          onClearMainEcho={() => updOptSets((settings) => ({ ...settings, lockedMainEchoId: null }))}
          onOpenInventorySearch={optInvMdl.show}
          onOpenSetCond={setCondsMdl.show}
          onOpenWeaponCond={wpnCondMdl.show}
          onGuide={() => navigate('/guides?category=optimizer')}
          onRules={openRlsMdl}
        />
      </div>
      </ContextTrigger>
    </OptimizerLab>
  )


  return (
    <div className="opt-host">
      <AppModal
        state={uiModal.dialogProps}
        variant="optimizer"
        ariaLabel="Optimizer notice"
        onClose={closeUiModal}
      >
        {uiModal.value}
      </AppModal>

      <AppModal
        state={rulesModal.dialogProps}
        variant="optimizer-rules"
        ariaLabel="Optimizer rules"
        onClose={clsRlsMdl}
      >
        {rulesModal.visible ? <Suspense fallback={<AppLdrVrly mode="inline" text="Loading optimizer rules..." />}><Rules onClose={clsRlsMdl} /></Suspense> : null}
      </AppModal>

      <SetCond
        {...setCondsMdl}
        portalTarget={mdlPrtlTgt}
        onClose={setCondsMdl.hide}
        title="Sonata Set Config"
        setConds={optSetConds}
        onSetCondsrx={(updater) => {
          clearRun()
          updResSetCon(optResId, updater)
        }}
      />

      {wpnCondMdl.visible ? <Suspense fallback={<AppLdrVrly mode="scrim" text="Loading weapon settings..." />}>
      <WpnCfgMdl
        {...wpnCondMdl}
        title="Config - Weapon Search"
        onClose={wpnCondMdl.hide}
        runtime={effectRuntime}
        seed={activeSeed}
        lockMaxMode
      />
      </Suspense> : null}

      {labSurface}

      {mainEchoPckr.visible ? <Suspense fallback={<AppLdrVrly mode="scrim" text="Loading Echo picker..." />}>
      <EchoPckrMdl
        visible={mainEchoPckr.visible}
        open={mainEchoPckr.open}
        closing={mainEchoPckr.closing}
        portalTarget={mdlPrtlTgt}
        echoes={allEchoes}
        selEchoId={selMainEchoI}
        slotIndex={0}
        maxCost={12}
        onSelect={(echoId: string) => {
          if (mainEchoPiece === 'filter') {
            mainEchoSession.update((settings) => ({
              ...settings,
              lockedMainEchoId: echoId,
            }))
            bumpPickerFreq({
              bucket: 'echo',
              ids: [echoId],
            })
            return
          }

          setEchoPlans((prev) => {
            const memRt = optRt ? makeOpSlot(optRt, mainEchoPiece, optRuntimesById) : null
            if (!memRt) {
              return prev
            }

            const next = [...prev] as [EchoPlan | null, EchoPlan | null]
            next[mainEchoPiece] = selMainEcho(
              prev[mainEchoPiece] ?? derEchoPlan(memRt.build.echoes),
              echoId,
            )
            return next
          })
          bumpPickerFreq({
            bucket: 'echo',
            ids: [echoId],
          })
        }}
        onClear={() => {
          if (mainEchoPiece === 'filter') {
            mainEchoSession.update((settings) => ({
              ...settings,
              lockedMainEchoId: null,
            }))
            return
          }

          setEchoPlans((prev) => {
            const memRt = optRt ? makeOpSlot(optRt, mainEchoPiece, optRuntimesById) : null
            if (!memRt) {
              return prev
            }

            const next = [...prev] as [EchoPlan | null, EchoPlan | null]
            next[mainEchoPiece] = selMainEcho(
              prev[mainEchoPiece] ?? derEchoPlan(memRt.build.echoes),
              null,
            )
            return next
          })
        }}
        onClose={clsMainEchoP}
      />
      </Suspense> : null}

      {optInvMdl.visible ? <Suspense fallback={<AppLdrVrly mode="scrim" text="Loading optimizer inventory..." />}>
      <OptimizerInventoryModal
        visible={optInvMdl.visible}
        open={optInvMdl.open}
        closing={optInvMdl.closing}
        invChs={optEligibleInvEchoE}
        echoSgByUid={optInvEchoSg}
        selection={optInvSelection}
        onSelectionChange={(updater) => updResOptInv(optResId, updater)}
        onClose={optInvMdl.hide}
      />
      </Suspense> : null}

    </div>
  )
}

const EchoPckrMdl = lazy(() => import('@/modules/simulation/features/echoes/Picker.tsx').then((module) => ({ default: module.EchoPicker })))

const WpnCfgMdl = lazy(() => import('@/modules/simulation/surfaces/suggestions/WeaponConfig.tsx').then((module) => ({ default: module.WpnCfgMdl })))

const Rules = lazy(() => import('@/modules/simulation/surfaces/optimizer/Rules.tsx').then((module) => ({ default: module.Rules })))

const OptimizerInventoryModal = lazy(() => import('@/modules/simulation/surfaces/optimizer/OptimizerInventoryModal.tsx').then((module) => ({ default: module.OptimizerInventoryModal })))
