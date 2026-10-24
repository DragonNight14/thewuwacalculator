/*
  Author: Runor Ewhro
  description: schedules suggestions jobs by mode and manages result keys, worker inputs, and route cleanup.
*/

import { useSuggestionTarget } from '@/modules/simulation/surfaces/suggestions/lib/useSuggestionTarget.ts'
import { useSavedRotationsLease } from '@/application/hooks/useSavedRotationsLease.ts'
import { useResonatorData } from '@/application/hooks/useResonatorData.ts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { WeaponPlanSet } from '@/domain/entities/suggestions.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { selActTgtSlc } from '@/application/state'
import { useAppStore } from '@/application/state'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { contextScenarioMember } from '@/domain/entities/combatScenario.ts'
import { listRotationDamageSources, resolveRotationDamageSource, rotationCombatSetup, rotationDamageContext } from '@/engine/rotation/damageSource.ts'
import { cancelSuggestionsJobs, runCompactSuggestion } from '@/engine/suggestions/client.ts'
import { clearSuggsSss, readSuggsSss, writeSuggsSs } from '@/engine/suggestions/sessionCache.ts'
import { evalSuggChs, mkRotSuggCtx, resSuggDmg } from '@/engine/suggestions/shared.ts'
import { isOptRotTgt } from '@/engine/search/score/eligibility.ts'
import type {
  CompactSetPlanSuggest,
  CompactSetPlanRun,
  CompactSuggestionJob,
  MainStatSugg,
  SuggestionSimulation,
  WeaponEntry,
} from '@/engine/suggestions/types.ts'
import type { SimResult } from '@/engine/pipeline/types.ts'
import { listWpnsByTy } from '@/data/catalog/weaponCatalogService.ts'
import {
  selectSuggestionTarget,
  suggestionTargetValue,
  targetGroups,
  targetOpts,
} from '@/modules/simulation/surfaces/suggestions/lib/helpers.ts'
import {
  DEFAULT_SUGG,
  DEFWPNSETS,
  inputSig,
  setsSig,
  wpnSig,
} from '@/modules/simulation/surfaces/suggestions/lib/suggestions.ts'
import type { SelectGroup } from '@/application/ui/Select'

const RERUN_MS = 300
const EMPTY_MAIN_RESULTS: MainStatSugg[] = []
const EMPTY_SET_RESULTS: CompactSetPlanSuggest[] = []
const EMPTY_WEAPON_RESULTS: WeaponEntry[] = []

export type SuggKind = 'mainStats' | 'setPlans' | 'weapons' | 'random' | 'substats'

export interface SuggRunsInput {
  runtime: ResRuntime
  simulation: SimResult | null
  enemyProfile: EnemyProfile
  prtcRntmById: Record<string, ResRuntime>
  setConds: SntSetConds
  mode: SuggKind
}

export interface SuggRuns {
  mainStatRslt: MainStatSugg[]
  setPlanRslt: CompactSetPlanSuggest[]
  wpnRslt: WeaponEntry[]
  rnnnMainStat: boolean
  rnnnSetPlns: boolean
  rnnnWpns: boolean

  baseDamage: number

  targetSkillGroups: SelectGroup<string>[]
  selTgtVl: string

  wpnSets: WeaponPlanSet
  activeSeed: ReturnType<typeof getResSeedBy>
  onSelectResults: (handler: (() => void) | null) => void
}

interface KeyedResults<T> {
  key: string | null
  results: T[]
}

interface KeyedSetPlanResults {
  key: string | null
  results: CompactSetPlanSuggest[]
  baseDamage: number | null
}

export function useSuggRuns({
  runtime: liveRuntime,
  simulation: liveSimulation,
  enemyProfile,
  prtcRntmById,
  setConds,
  mode,
}: SuggRunsInput): SuggRuns {
  const [mainStatRun, setMainStatRun] = useState<KeyedResults<MainStatSugg>>({ key: null, results: [] })
  const [setPlanRun, setSetPlanRun] = useState<KeyedSetPlanResults>({ key: null, results: [], baseDamage: null })
  const [wpnRun, setWpnRun] = useState<KeyedResults<WeaponEntry>>({ key: null, results: [] })

  const selTrgtByOwn = useAppStore(selActTgtSlc)
  const scenario = useAppStore((state) => selectedCombatScenario(state.combat))
  const scenarioWorkspace = useAppStore((state) => state.combat)
  const liveScenarios = useMemo(() => scenarioWorkspace.order.flatMap((id) => {
    const entry = scenarioWorkspace.scenariosById[id]
    return entry ? [entry] : []
  }), [scenarioWorkspace])
  const weaponSuggests = useAppStore((state) => state.simulation.weaponSuggests)
  const suggsStt = useAppStore((state) => state.simulation.suggestionsByResonatorId[liveRuntime.id]) ?? DEFAULT_SUGG
  useSavedRotationsLease()
  const savedRotations = useAppStore((state) => state.library.rotations)
  const savedRotationsHydrated = useAppStore((state) => state.savedRotationsHydrated)
  const pendingSavedSource = !savedRotationsHydrated
    && suggsStt.settings.rotationSourceId?.startsWith('saved:')
  const sourceOptions = useMemo(
    () => listRotationDamageSources(scenario, savedRotations, liveRuntime.id, liveScenarios),
    [scenario, savedRotations, liveRuntime.id, liveScenarios],
  )
  const source = useMemo(
    () => suggsStt.settings.rotationMode && !pendingSavedSource
      ? resolveRotationDamageSource(suggsStt.settings.rotationSourceId, scenario, savedRotations, liveRuntime.id, liveScenarios)
      : null,
    [scenario, savedRotations, liveRuntime.id, liveScenarios, pendingSavedSource, suggsStt.settings.rotationMode, suggsStt.settings.rotationSourceId],
  )
  const scenarioIdentity = useMemo(() => ({
    scenarioId: scenario.id,
    memberId: contextScenarioMember(scenario).id,
  }), [scenario])
  const sourceDataReady = useResonatorData(
    source?.savedTeamContext?.team.members.map((member) => member.resonatorId) ?? [],
  )
  const pendingSource = pendingSavedSource || !sourceDataReady
  const savedContext = useMemo(
    () => source && sourceDataReady ? rotationDamageContext(source, scenario, liveRuntime) : null,
    [source, scenario, liveRuntime, sourceDataReady],
  )
  const combatSetup = useMemo(
    () => suggsStt.settings.rotationMode
      ? savedContext?.combatSetup ?? rotationCombatSetup(scenario)
      : undefined,
    [savedContext, scenario, suggsStt.settings.rotationMode],
  )
  const sourceRuntime = savedContext?.runtime ?? liveRuntime
  const sourceParticipants = savedContext?.runtimesById ?? prtcRntmById
  const sourceTargets = savedContext?.selectedTargets ?? selTrgtByOwn
  const updActResSug = useAppStore((state) => state.updActSuggs)
  const { runtime, simulation: selectedSimulation } = useSuggestionTarget(
    sourceRuntime, liveSimulation, suggsStt.settings, enemyProfile, sourceParticipants, sourceTargets,
    source?.items,
    combatSetup,
    !pendingSource,
  )
  const simulation = selectedSimulation

  const wpnSets = useMemo<WeaponPlanSet>(() => ({
    ...DEFWPNSETS,
    ...(weaponSuggests ?? {}),
    stdRank: weaponSuggests?.stdRank ?? DEFWPNSETS.stdRank,
    ranks: { ...DEFWPNSETS.ranks, ...(weaponSuggests?.ranks ?? {}) },
    visible: { ...DEFWPNSETS.visible, ...(weaponSuggests?.visible ?? {}) },
    states: weaponSuggests?.states ?? DEFWPNSETS.states,
  }), [weaponSuggests])

  const activeSeed = useMemo(() => getResSeedBy(runtime.id), [runtime.id])
  const setCondsSig = useMemo(() => setsSig(setConds), [setConds])
  const [running, setRunning] = useState<{ kind: 'mainStats' | 'setPlans' | 'weapons'; runId: number } | null>(null)
  const nextRunId = useRef(0)
  const forceNext = useRef(false)
  const didHydrSetCo = useRef(false)
  const onResultsRef = useRef<(() => void) | null>(null)

  const onSelectResults = useCallback((handler: (() => void) | null) => {
    onResultsRef.current = handler
  }, [])

  const mutableTargetOptions = useMemo(
    () => targetOpts(runtime.id, simulation, {}, sourceOptions),
    [runtime.id, simulation, sourceOptions],
  )
  const fixedTargetOptions = useMemo(
    () => targetOpts(runtime.id, simulation, { includeEchoAttacks: true }, sourceOptions),
    [runtime.id, simulation, sourceOptions],
  )
  const usesFixedTargets = mode === 'substats' || mode === 'weapons'
  const targetOptions = usesFixedTargets ? fixedTargetOptions : mutableTargetOptions
  const targetSkillGroups = useMemo(() => targetGroups(targetOptions), [targetOptions])

  const selTgtVl = suggestionTargetValue(suggsStt.settings)
  const hasMutableTarget = mutableTargetOptions.some((option) => option.value === selTgtVl)
  const hasFixedTarget = fixedTargetOptions.some((option) => option.value === selTgtVl)
  useEffect(() => {
    if (!savedRotationsHydrated && suggsStt.settings.rotationSourceId?.startsWith('saved:')) return
    // earlier selections stored cross-scenario rotation ids as skill targets.
    if (!suggsStt.settings.rotationMode && sourceOptions.some((option) => option.id === selTgtVl)) {
      updActResSug((state) => ({
        ...state,
        settings: selectSuggestionTarget(state.settings, selTgtVl),
      }))
      return
    }
    if (targetOptions.length === 0 || targetOptions.some((option) => option.value === selTgtVl)) return
    updActResSug((state) => ({
      ...state,
      settings: selectSuggestionTarget(state.settings, targetOptions[0].value),
    }))
  }, [savedRotationsHydrated, selTgtVl, sourceOptions, suggsStt.settings.rotationMode, suggsStt.settings.rotationSourceId, targetOptions, updActResSug])

  const ctxBase = useMemo(() => activeSeed ? ({
    ...scenarioIdentity,
    runtime, seed: activeSeed, enemy: enemyProfile,
    runtimesById: sourceParticipants, selectedTargets: sourceTargets, setConds,
    combatSetup,
    tgtFeatId: suggsStt.settings.targetFeatureId,
    rotationMode: suggsStt.settings.rotationMode,
    includeEchoAttacks: true,
  }) : null, [
    activeSeed, enemyProfile, sourceParticipants, runtime, scenarioIdentity,
    sourceTargets, combatSetup, setConds, suggsStt.settings.rotationMode,
    suggsStt.settings.targetFeatureId,
  ])

  // the worker uses these rows for direct targets and rotation search heuristics.
  // rotation candidate totals use the shared numeric damage plan.
  const compactSimulation = useMemo<SuggestionSimulation | null>(() => simulation ? ({
    finalStats: simulation.finalStats,
    allSkills: simulation.allSkills.filter((entry) => isOptRotTgt(entry, runtime.id, { includeEchoAttacks: true })),
    rotation: { sequence: { entries: simulation.rotation.sequence.entries.filter(
      (entry) => isOptRotTgt(entry, runtime.id, { includeEchoAttacks: true }),
    ) } },
  }) : null, [runtime.id, simulation])

  const scope = useMemo(() => {
    const participants = [runtime, ...Object.values(sourceParticipants)]
    const candidates = activeSeed ? listWpnsByTy(activeSeed.weaponType)
      .filter((weapon) => wpnSets.visible[String(weapon.rarity)] ?? false)
      .map((weapon) => weapon.id) : []
    return {
      resonatorIds: [...new Set(participants.map((participant) => participant.id))],
      weaponIds: [...new Set([
        ...participants.flatMap((participant) => participant.build.weapon.id ? [participant.build.weapon.id] : []),
        ...candidates,
      ])],
    }
  }, [activeSeed, sourceParticipants, runtime, wpnSets])

  const liveBaseDamage = useMemo(() => {
    if (!simulation || !ctxBase || !(mode === 'weapons' ? hasFixedTarget : hasMutableTarget)) return 0
    const input = mode === 'weapons' ? { ...ctxBase, setStateMode: 'resolved' as const } : ctxBase
    if (ctxBase.rotationMode) {
      const context = mkRotSuggCtx(input, simulation)
      return context ? evalSuggChs(context, runtime.build.echoes) : 0
    }
    return resSuggDmg(simulation, input)
  }, [ctxBase, hasFixedTarget, hasMutableTarget, mode, runtime.build.echoes, simulation])

  // the common input signature is serialized once. mode-specific options are
  // encoded in the versioned suffixes, preserving the old invalidation rules.
  const sharedSig = useMemo(() => inputSig({
    runtime, enemyProfile, prtcRntmById: sourceParticipants, selectedTargets: sourceTargets,
    combatSetup,
    setConds, tgtFeatId: suggsStt.settings.targetFeatureId,
    rotationMode: suggsStt.settings.rotationMode, includeEchoAttacks: true,
  }), [
    enemyProfile, sourceParticipants, runtime, sourceTargets, combatSetup, setConds,
    suggsStt.settings.rotationMode, suggsStt.settings.targetFeatureId,
  ])
  const mainSttsCchK = `main:v4:${runtime.id}:${sharedSig}:resolved`
  const setPlnsCchKe = `sets:v16:${runtime.id}:${sharedSig}:max`
  const wpnCchKey = useMemo(
    () => `weapon:v4:${runtime.id}:${sharedSig}:resolved:${wpnSig(wpnSets)}`,
    [runtime.id, sharedSig, wpnSets],
  )

  /* a baseline follows the live input immediately, while worker results arrive
     later. only expose rows produced for the same signature so an old result
     can never be measured against a new base during that gap. */
  const mainStatRslt = mainStatRun.key === mainSttsCchK ? mainStatRun.results : EMPTY_MAIN_RESULTS
  const setPlanRslt = setPlanRun.key === setPlnsCchKe ? setPlanRun.results : EMPTY_SET_RESULTS
  const baseDamage = mode === 'setPlans' && setPlanRun.key === setPlnsCchKe && setPlanRun.baseDamage != null
    ? setPlanRun.baseDamage
    : liveBaseDamage
  const wpnRslt = wpnRun.key === wpnCchKey ? wpnRun.results : EMPTY_WEAPON_RESULTS

  useEffect(() => {
    if (!didHydrSetCo.current) { didHydrSetCo.current = true; return }
    forceNext.current = true
  }, [setCondsSig])

  useEffect(() => {
    // a changed input or selected mode invalidates queued and synchronous work.
    // terminating the worker also works when SharedArrayBuffer is unavailable.
    let valid = true
    let activeRunId: number | null = null
    // release stale result graphs before the next job allocates its finalists.
    setMainStatRun((previous) => previous.key === mainSttsCchK || previous.results.length === 0 ? previous : { key: null, results: [] })
    setSetPlanRun((previous) => previous.key === setPlnsCchKe || previous.results.length === 0 ? previous : { key: null, results: [], baseDamage: null })
    setWpnRun((previous) => previous.key === wpnCchKey || previous.results.length === 0 ? previous : { key: null, results: [] })
    const selected: 'mainStats' | 'setPlans' | 'weapons' = mode === 'setPlans' || mode === 'weapons' ? mode : 'mainStats'
    const order = [selected, ...(['mainStats', 'setPlans', 'weapons'] as const).filter((kind) => kind !== selected)]
    const timer = setTimeout(() => {
      const force = forceNext.current
      forceNext.current = false
      const payload: CompactSuggestionJob | null = ctxBase && compactSimulation
        ? { input: ctxBase, simulation: compactSimulation, weapon: wpnSets, ...scope }
        : null
      const run = async () => {
        for (const kind of order) {
          if (!valid) return
          const key = kind === 'mainStats' ? mainSttsCchK : kind === 'setPlans' ? setPlnsCchKe : wpnCchKey
          const allowed = kind === 'weapons' ? hasFixedTarget : hasMutableTarget
          const apply = (results: MainStatSugg[] | CompactSetPlanRun | WeaponEntry[]) => {
            if (!valid) return
            if (kind === 'mainStats') setMainStatRun({ key, results: results as MainStatSugg[] })
            else if (kind === 'setPlans') {
              const setRun = results as CompactSetPlanRun
              setSetPlanRun({ key, results: setRun.results, baseDamage: setRun.baseDamage })
            }
            else setWpnRun({ key, results: results as WeaponEntry[] })
            if (kind === selected) onResultsRef.current?.()
          }
          if (!payload || !allowed) {
            const empty = kind === 'setPlans' ? { baseDamage: liveBaseDamage, results: [] } : []
            apply(empty)
            continue
          }
          const cached = !force && readSuggsSss<MainStatSugg[] | CompactSetPlanRun | WeaponEntry[]>(key)
          if (cached) {
            apply(cached)
            continue
          }
          const runId = ++nextRunId.current
          activeRunId = runId
          setRunning({ kind, runId })
          try {
            const results = await runCompactSuggestion(kind, payload)
            if (!valid) return
            writeSuggsSs(key, results)
            apply(results)
          } catch {
            if (valid) {
              const empty = kind === 'setPlans' ? { baseDamage: liveBaseDamage, results: [] } : []
              apply(empty)
            }
          } finally {
            if (valid) setRunning((current) => current?.runId === runId ? null : current)
            activeRunId = null
          }
        }
      }
      void run()
    }, RERUN_MS)
    return () => {
      valid = false
      clearTimeout(timer)
      cancelSuggestionsJobs()
      const cancelledRunId = activeRunId
      if (cancelledRunId) setRunning((current) => current?.runId === cancelledRunId ? null : current)
    }
  }, [
    compactSimulation, ctxBase, hasFixedTarget, hasMutableTarget, liveBaseDamage, mainSttsCchK,
    mode, scope, setCondsSig, setPlnsCchKe, wpnCchKey, wpnSets,
  ])

  useEffect(() => () => {
    cancelSuggestionsJobs()
    clearSuggsSss(['main:v3:', 'main:v4:', 'sets:v4:', 'sets:v5:', 'sets:v6:', 'sets:v7:', 'sets:v8:', 'sets:v9:', 'sets:v10:', 'sets:v11:', 'sets:v12:', 'sets:v13:', 'sets:v14:', 'sets:v15:', 'sets:v16:', 'weapon:v2:', 'weapon:v3:', 'weapon:v4:'])
  }, [])

  return {
    mainStatRslt, setPlanRslt, wpnRslt,
    rnnnMainStat: running?.kind === 'mainStats',
    rnnnSetPlns: running?.kind === 'setPlans',
    rnnnWpns: running?.kind === 'weapons',
    baseDamage, targetSkillGroups, selTgtVl, wpnSets, activeSeed, onSelectResults,
  }
}
