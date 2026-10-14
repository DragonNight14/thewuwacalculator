/*
  Author: Runor Ewhro
  description: schedules suggestions jobs by mode and manages result keys, worker inputs, and route cleanup.
*/

import { useSuggestionTarget } from '@/modules/simulation/surfaces/suggestions/lib/useSuggestionTarget.ts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { WeaponPlanSet } from '@/domain/entities/suggestions.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { selActTgtSlc } from '@/application/state'
import { useAppStore } from '@/application/state'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { cancelSuggestionsJobs, runCompactSuggestion } from '@/engine/suggestions/client.ts'
import { clearSuggsSss, readSuggsSss, writeSuggsSs } from '@/engine/suggestions/sessionCache.ts'
import { resSuggDmg } from '@/engine/suggestions/shared.ts'
import { isOptRotTgt } from '@/engine/optimizer/rules/eligibility.ts'
import type {
  CompactSetPlanSuggest,
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

export function useSuggRuns({
  runtime: liveRuntime,
  simulation: liveSimulation,
  enemyProfile,
  prtcRntmById,
  setConds,
  mode,
}: SuggRunsInput): SuggRuns {
  const [mainStatRun, setMainStatRun] = useState<KeyedResults<MainStatSugg>>({ key: null, results: [] })
  const [setPlanRun, setSetPlanRun] = useState<KeyedResults<CompactSetPlanSuggest>>({ key: null, results: [] })
  const [wpnRun, setWpnRun] = useState<KeyedResults<WeaponEntry>>({ key: null, results: [] })

  const selTrgtByOwn = useAppStore(selActTgtSlc)
  const scenarioId = useAppStore((state) => selectedCombatScenario(state.combat).id)
  const memberId = useAppStore((state) => selectedCombatScenario(state.combat).team.members[0].id)
  const scenarioIdentity = useMemo(
    () => ({ scenarioId, memberId }),
    [memberId, scenarioId],
  )
  const weaponSuggests = useAppStore((state) => state.simulation.weaponSuggests)
  const suggsStt = useAppStore((state) => state.simulation.suggestionsByResonatorId[liveRuntime.id]) ?? DEFAULT_SUGG
  const updActResSug = useAppStore((state) => state.updActSuggs)
  const { runtime, simulation } = useSuggestionTarget(
    liveRuntime, liveSimulation, suggsStt.settings, enemyProfile, prtcRntmById, selTrgtByOwn,
  )

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
  const [running, setRunning] = useState<'mainStats' | 'setPlans' | 'weapons' | null>(null)
  const forceNext = useRef(false)
  const didHydrSetCo = useRef(false)
  const onResultsRef = useRef<(() => void) | null>(null)

  const onSelectResults = useCallback((handler: (() => void) | null) => {
    onResultsRef.current = handler
  }, [])

  const mutableTargetOptions = useMemo(
    () => targetOpts(runtime.id, simulation),
    [runtime.id, simulation],
  )
  const fixedTargetOptions = useMemo(
    () => targetOpts(runtime.id, simulation, { includeEchoAttacks: true }),
    [runtime.id, simulation],
  )
  const usesFixedTargets = mode === 'substats' || mode === 'weapons'
  const targetOptions = usesFixedTargets ? fixedTargetOptions : mutableTargetOptions
  const targetSkillGroups = useMemo(() => targetGroups(targetOptions), [targetOptions])

  const selTgtVl = suggestionTargetValue(suggsStt.settings)
  const hasMutableTarget = mutableTargetOptions.some((option) => option.value === selTgtVl)
  const hasFixedTarget = fixedTargetOptions.some((option) => option.value === selTgtVl)

  useEffect(() => {
    if (targetOptions.length === 0 || targetOptions.some((option) => option.value === selTgtVl)) return
    updActResSug((state) => ({
      ...state,
      settings: selectSuggestionTarget(state.settings, targetOptions[0].value),
    }))
  }, [selTgtVl, targetOptions, updActResSug])

  const ctxBase = useMemo(() => activeSeed ? ({
    ...scenarioIdentity,
    runtime, seed: activeSeed, enemy: enemyProfile,
    runtimesById: prtcRntmById, selectedTargets: selTrgtByOwn, setConds,
    tgtFeatId: suggsStt.settings.targetFeatureId,
    rotationMode: suggsStt.settings.rotationMode,
    includeEchoAttacks: true,
  }) : null, [
    activeSeed, enemyProfile, prtcRntmById, runtime, scenarioIdentity,
    selTrgtByOwn, setConds, suggsStt.settings.rotationMode,
    suggsStt.settings.targetFeatureId,
  ])

  // only these fields are read to build packed search contexts. finalists are
  // still measured by the canonical simulation inside the worker.
  const compactSimulation = useMemo<SuggestionSimulation | null>(() => simulation ? ({
    finalStats: simulation.finalStats,
    allSkills: simulation.allSkills.filter((entry) => isOptRotTgt(entry, runtime.id, { includeEchoAttacks: true })),
    rotation: { sequence: { entries: simulation.rotation.sequence.entries.filter(
      (entry) => isOptRotTgt(entry, runtime.id, { includeEchoAttacks: true }),
    ) } },
  }) : null, [runtime.id, simulation])

  const scope = useMemo(() => {
    const participants = [runtime, ...Object.values(prtcRntmById)]
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
  }, [activeSeed, prtcRntmById, runtime, wpnSets])

  const baseDamage = useMemo(() => {
    if (!simulation || !ctxBase || !(mode === 'weapons' ? hasFixedTarget : hasMutableTarget)) return 0
    return resSuggDmg(simulation, mode === 'weapons'
      ? { ...ctxBase, setStateMode: 'resolved' } : ctxBase)
  }, [ctxBase, hasFixedTarget, hasMutableTarget, mode, simulation])

  // the common input signature is serialized once. mode-specific options are
  // encoded in the versioned suffixes, preserving the old invalidation rules.
  const sharedSig = useMemo(() => inputSig({
    runtime, enemyProfile, prtcRntmById, selectedTargets: selTrgtByOwn,
    setConds, tgtFeatId: suggsStt.settings.targetFeatureId,
    rotationMode: suggsStt.settings.rotationMode, includeEchoAttacks: true,
  }), [
    enemyProfile, prtcRntmById, runtime, selTrgtByOwn, setConds,
    suggsStt.settings.rotationMode, suggsStt.settings.targetFeatureId,
  ])
  const mainSttsCchK = `main:v3:${runtime.id}:${sharedSig}:resolved`
  const setPlnsCchKe = `sets:v4:${runtime.id}:${sharedSig}:max`
  const wpnCchKey = useMemo(
    () => `weapon:v2:${runtime.id}:${sharedSig}:resolved:${wpnSig(wpnSets)}`,
    [runtime.id, sharedSig, wpnSets],
  )

  /* a baseline follows the live input immediately, while worker results arrive
     later. only expose rows produced for the same signature so an old result
     can never be measured against a new base during that gap. */
  const mainStatRslt = mainStatRun.key === mainSttsCchK ? mainStatRun.results : EMPTY_MAIN_RESULTS
  const setPlanRslt = setPlanRun.key === setPlnsCchKe ? setPlanRun.results : EMPTY_SET_RESULTS
  const wpnRslt = wpnRun.key === wpnCchKey ? wpnRun.results : EMPTY_WEAPON_RESULTS

  useEffect(() => {
    if (!didHydrSetCo.current) { didHydrSetCo.current = true; return }
    forceNext.current = true
  }, [setCondsSig])

  useEffect(() => {
    // a changed input or selected mode invalidates queued and synchronous work.
    // terminating the worker also works when SharedArrayBuffer is unavailable.
    let valid = true
    // release stale result graphs before the next job allocates its finalists.
    setMainStatRun((previous) => previous.key === mainSttsCchK || previous.results.length === 0 ? previous : { key: null, results: [] })
    setSetPlanRun((previous) => previous.key === setPlnsCchKe || previous.results.length === 0 ? previous : { key: null, results: [] })
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
          const apply = (results: MainStatSugg[] | CompactSetPlanSuggest[] | WeaponEntry[]) => {
            if (!valid) return
            if (kind === 'mainStats') setMainStatRun({ key, results: results as MainStatSugg[] })
            else if (kind === 'setPlans') setSetPlanRun({ key, results: results as CompactSetPlanSuggest[] })
            else setWpnRun({ key, results: results as WeaponEntry[] })
            if (kind === selected) onResultsRef.current?.()
          }
          if (!payload || !allowed) { apply([]); continue }
          const cached = !force && readSuggsSss<MainStatSugg[] | CompactSetPlanSuggest[] | WeaponEntry[]>(key)
          if (cached) { apply(cached); continue }
          setRunning(kind)
          try {
            const results = await runCompactSuggestion(kind, payload)
            if (!valid) return
            writeSuggsSs(key, results)
            apply(results)
          } catch (error) {
            if (valid) {
              console.error(`[Suggestions] ${kind} search failed`, error)
              apply([])
            }
          } finally {
            if (valid) setRunning(null)
          }
        }
      }
      void run()
    }, RERUN_MS)
    return () => {
      valid = false
      clearTimeout(timer)
      cancelSuggestionsJobs()
    }
  }, [
    compactSimulation, ctxBase, hasFixedTarget, hasMutableTarget, mainSttsCchK,
    mode, scope, setCondsSig, setPlnsCchKe, wpnCchKey, wpnSets,
  ])

  useEffect(() => () => {
    cancelSuggestionsJobs()
    clearSuggsSss(['main:v3:', 'sets:v4:', 'weapon:v2:'])
  }, [])

  return {
    mainStatRslt, setPlanRslt, wpnRslt,
    rnnnMainStat: running === 'mainStats',
    rnnnSetPlns: running === 'setPlans',
    rnnnWpns: running === 'weapons',
    baseDamage, targetSkillGroups, selTgtVl, wpnSets, activeSeed, onSelectResults,
  }
}
