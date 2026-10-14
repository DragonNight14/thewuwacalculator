/*
  Author: Runor Ewhro
  description: coordinates suggestion search state, candidate previews, and
               application of selected echo, set-plan, or weapon results.
*/

import '@/styles/surfaces/suggestions/results.css'
import { selectSuggestionTarget } from '@/modules/simulation/surfaces/suggestions/lib/helpers.ts'

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import AppLoaderOverlay from '@/shared/ui/AppLoaderOverlay'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/application/state'
import { selEnemyProf, selVrvwDrvd, selWorkDrvd } from '@/application/state'
import { selLiveRun } from '@/modules/simulation/model/selectors.ts'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { DEF_SET_COND } from '@/domain/entities/sonataSetConditionals.ts'
import { cloneEchoLoadout } from '@/domain/entities/inventoryStorage.ts'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import type { CompactSetPlanSuggest, MainStatSugg, WeaponEntry } from '@/engine/suggestions/types.ts'
import type { PickFreqWeapon } from '@/domain/entities/appState.ts'
import { getResonator, WPNTYPETOKEY } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { OptimizerEchoPreview } from '@/modules/simulation/surfaces/optimizer/transport/OptimizerEchoPreview.tsx'
import { useSuggRuns } from '@/modules/simulation/surfaces/suggestions/lib/useSuggRuns.ts'
import { smmrCurSetPl } from '@/modules/simulation/surfaces/suggestions/lib/suggestions.ts'
import { Results } from '@/modules/simulation/surfaces/suggestions/results/Results.tsx'
import { Comparison } from '@/modules/simulation/surfaces/suggestions/results/Comparison.tsx'
import {
  buildRows,
  isKind,
  materializeRowEchoes,
  materializeWeaponSuggestion,
  wornMainStats,
  type Kind,
  type Row,
} from '@/modules/simulation/surfaces/suggestions/results/model.ts'
import { SetCond } from '@/modules/simulation/features/controls/SetConditional.tsx'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'

const EMPTY_ECHOES: Array<EchoInstance | null> = []
const WpnCfgMdl = lazy(() => import('@/modules/simulation/surfaces/suggestions/WeaponConfig.tsx').then((module) => ({ default: module.WpnCfgMdl })))

export function Page() {
  const enemyProfile = useAppStore(selEnemyProf)
  const { prepWork } = useAppStore(useShallow(selWorkDrvd))
  const { actRt: runtime, partRtsById } = useAppStore(useShallow(selVrvwDrvd))
  const simulation = useMemo(() => selLiveRun(prepWork), [prepWork])
  const setConds = useAppStore((state) => (
    selectedCombatScenario(state.combat).team.members.find(
      (member) => member.resonatorId === runtime?.id,
    )?.local.setConditionals ?? DEF_SET_COND
  ))
  const updActResRt = useAppStore((state) => state.updActRt)
  const updActResSug = useAppStore((state) => state.updActSuggs)
  const updResSetCon = useAppStore((state) => state.updActConds)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const storedMode = useAppStore((state) => state.ui.suggsViewMode)
  const setSugView = useAppStore((state) => state.setSugView)
  const kind: Kind = isKind(storedMode) ? storedMode : 'mainStats'

  const [held, setHeld] = useState(0)
  const setCondsMdl = useAppModal()
  const wpnCondMdl = useAppModal()
  const portalTarget = mainPortal()

  const subject = runtime ? getResonator(runtime.id) : null

  const search = useSuggRuns({
    runtime: runtime!,
    simulation,
    enemyProfile,
    prtcRntmById: partRtsById,
    setConds,
    mode: kind,
  })

  const onSelectResults = search.onSelectResults
  const resetHeld = useCallback(() => setHeld(0), [])
  useEffect(() => {
    onSelectResults(resetHeld)
    return () => onSelectResults(null)
  }, [onSelectResults, resetHeld])

  const echoes = runtime?.build.echoes ?? EMPTY_ECHOES
  const worn = useMemo(() => wornMainStats(echoes), [echoes])
  const wornSetPlan = useMemo(() => smmrCurSetPl(echoes), [echoes])
  const activeResults = kind === 'mainStats' ? search.mainStatRslt
    : kind === 'setPlans' ? search.setPlanRslt : search.wpnRslt
  const rows = useMemo<Row[]>(() => buildRows({
    kind,
    mainStatRslt: kind === 'mainStats' ? activeResults as MainStatSugg[] : [],
    setPlanRslt: kind === 'setPlans' ? activeResults as CompactSetPlanSuggest[] : [],
    wpnRslt: kind === 'weapons' ? activeResults as WeaponEntry[] : [],
    base: search.baseDamage,
    echoes,
    worn,
    wornSetPlan,
    runtime: runtime!,
  }), [
    echoes,
    kind,
    runtime,
    search.baseDamage,
    activeResults,
    worn,
    wornSetPlan,
  ])

  const heldRow = rows[held] ?? null
  const preview = useMemo(
    () => heldRow && !heldRow.now ? materializeRowEchoes(heldRow, echoes) : null,
    [echoes, heldRow],
  )

  const applyRow = useCallback((row: Row) => {
    if (row.weapon) {
      const plan = row.weapon
      const wpnKey = (
        WPNTYPETOKEY[subject?.weaponType ?? 4] ?? 'gauntlets'
      ) as PickFreqWeapon

      updActResRt((curRt) => materializeWeaponSuggestion(curRt, plan))

      bumpPickerFreq({ bucket: 'weapon', weaponType: wpnKey, ids: [plan.weaponId] })
      return
    }

    const materialized = materializeRowEchoes(row, echoes)
    if (!materialized) return
    const next: Array<EchoInstance | null> = cloneEchoLoadout(materialized)
    updActResRt((curRt) => ({
      ...curRt,
      build: { ...curRt.build, echoes: next },
    }))
  }, [bumpPickerFreq, echoes, subject?.weaponType, updActResRt])

  const writeEchoes = useCallback((next: Array<EchoInstance | null>) => {
    updActResRt((curRt) => ({
      ...curRt,
      build: { ...curRt.build, echoes: cloneEchoLoadout(next) },
    }))
  }, [updActResRt])

  const onTarget = useCallback((value: string) => {
    updActResSug((state) => ({
      ...state,
      settings: selectSuggestionTarget(state.settings, value),
    }))
  }, [updActResSug])

  if (!runtime) return null

  return (
    <main className="wk-main" data-phase="idle">
      <OptimizerEchoPreview
        previewKey={`${runtime.id}:${kind}:${heldRow?.key ?? 'build'}`}
        resonatorId={runtime.id}
        resonatorName={subject?.name ?? runtime.id}
        runtime={runtime}
        sourceEchoes={preview ?? echoes}
        editable
        onEquip={writeEchoes}
      />

      <section className="wk-section wk-span wk-ink sgl-run">
        <Results
          kind={kind}
          onKind={(next) => {
            setHeld(0)
            setSugView(next)
          }}
          counts={{
            mainStats: search.mainStatRslt.length,
            setPlans: search.setPlanRslt.length,
            weapons: new Set(search.wpnRslt.map((plan) => plan.weaponId)).size,
          }}
          rows={rows}
          base={search.baseDamage}
          held={held}
          onHeld={setHeld}
          onApply={applyRow}
          comparison={heldRow ? (
            <Comparison kind={kind} row={heldRow} weapon={runtime.build.weapon} echoes={echoes} preview={preview} />
          ) : null}
          running={
            kind === 'mainStats' ? search.rnnnMainStat
              : kind === 'setPlans' ? search.rnnnSetPlns
                : search.rnnnWpns
          }
          targetValue={search.selTgtVl}
          targetGroups={search.targetSkillGroups}
          onTarget={onTarget}
          wpnSets={search.wpnSets}
          setConds={setConds}
          onOpenConfig={() => (kind === 'weapons' ? wpnCondMdl.show() : setCondsMdl.show())}
        />
      </section>

      <SetCond
        {...setCondsMdl}
        portalTarget={portalTarget}
        onClose={setCondsMdl.hide}
        title="Sonata Set Config"
        setConds={setConds}
        onSetCondsrx={updResSetCon}
      />

      {wpnCondMdl.visible ? <Suspense fallback={<AppLoaderOverlay mode="scrim" text="Loading weapon settings..." />}>
        <WpnCfgMdl
          {...wpnCondMdl}
          title="Config - Weapon Search"
          onClose={wpnCondMdl.hide}
          runtime={runtime}
          seed={search.activeSeed}
        />
      </Suspense> : null}
    </main>
  )
}
