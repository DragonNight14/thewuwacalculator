/*
  Author: Runor Ewhro
  description: connects evaluation report state to the modulation band,
               loadout, stats, and report drawer.
*/

import { useEffect, useRef, useState } from 'react'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'
import type { EvaluationBuildSnapshot, EvaluationEchoSlot, BuildEvaluationReport } from '@/engine/evaluation/buildEvaluation.ts'
import type { ResView } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { MemberSelector } from '@/modules/simulation/surfaces/modulation/MemberSelector.tsx'
import { TeamEditButton } from '@/modules/simulation/features/teams/TeamEditButton.tsx'
import {
  EchoCard,
  type EvaluationEchoActions,
  type EvaluationEchoSelection,
} from '@/modules/simulation/workspace/ui.tsx'
import { EvaluationBand } from './EvaluationBand.tsx'
import { LoadoutHead } from '@/modules/simulation/workspace/LoadoutHead.tsx'
import { ModulationView, findScroller, memberAccent, type ModulationPanel } from './Modulation.tsx'
import type { MemberAnalysisSource } from './lib/memberSim.ts'

export function ModulationReport({
  modulationRuntime,
  modulationActRt,
  modulationAnalysisSource,
  modulationDark,
  modulationRoster,
  modulationMemberId,
  onModulationMember,
  onModulationUpdate,
  report,
  detailReport,
  detailReportReady,
  detailReportLoading,
  reportOpen,
  onReportOpen,
  onReportClose,
  activeBuild,
  referenceBuild,
  maximumBuild,
  score,
  grade,
  tone,
  reportRuntime,
  echoSelection,
  echoActions,
  echoScores,
  loadoutSlots,
  sourceEchoes,
  onEchoOpen,
  echoRuntime,
  echoScenarioId,
  echoResonatorName,
  echoEditable,
  canSaveEcho,
  onEchoLoadout,
}: {
  modulationRuntime: ResRuntime | null
  modulationActRt: ResRuntime | null
  modulationAnalysisSource: MemberAnalysisSource | null
  modulationDark: boolean
  modulationRoster: ResView[]
  modulationMemberId: string | null
  onModulationMember: (resonatorId: string) => void
  onModulationUpdate: (updater: (runtime: ResRuntime) => ResRuntime) => void
  report: BuildEvaluationReport | null
  detailReport: BuildEvaluationReport | null
  detailReportReady: boolean
  detailReportLoading: boolean
  reportOpen: boolean
  onReportOpen: () => void
  onReportClose: () => void
  activeBuild: EvaluationBuildSnapshot | null
  referenceBuild: EvaluationBuildSnapshot | null
  maximumBuild: EvaluationBuildSnapshot | null
  score: number | null
  grade: string | null
  tone: string
  reportRuntime: ResRuntime | null
  echoSelection?: EvaluationEchoSelection
  echoActions?: EvaluationEchoActions
  echoScores?: Array<number | null> | null
  loadoutSlots: Array<EvaluationEchoSlot | null>
  sourceEchoes: Array<EchoInstance | null>
  onEchoOpen?: (slotIndex: number) => void
  /** runtime used by loadout mutations; null prevents writes to a stale report. */
  echoRuntime: ResRuntime | null
  echoScenarioId: CombatScenarioId
  echoResonatorName?: string | null
  echoEditable: boolean
  canSaveEcho: (echo: EchoInstance) => boolean
  onEchoLoadout: (echoes: Array<EchoInstance | null>) => void
}) {
  const [modulationPanel, setModulationPanel] = useState<ModulationPanel>('stats')
  const loadoutHead = useRef<HTMLElement | null>(null)
  const [seatOut, setSeatOut] = useState(false)

  useEffect(() => {
    const node = loadoutHead.current
    if (!node) return

    const scroller = findScroller(node)
    if (!scroller) return

    const read = () => {
      const gone = node.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().top
      setSeatOut((was) => (was === gone ? was : gone))
    }

    queueMicrotask(read)
    scroller.addEventListener('scroll', read, { passive: true })
    window.addEventListener('resize', read)
    return () => {
      scroller.removeEventListener('scroll', read)
      window.removeEventListener('resize', read)
    }
  }, [modulationPanel])
  const echoSurfaceProps = echoSelection?.surfaceProps ?? {}
  const evaluationMatchesModulationMember = modulationRuntime?.id === reportRuntime?.id

  const viewedMember = modulationRoster.find((mate) => mate.id === modulationMemberId) ?? null
  const echoLoadout = (
    <section className="wk-section wk-span wk-ink"
      style={memberAccent(viewedMember)}
    >
      <LoadoutHead
        headRef={loadoutHead}
        runtime={echoRuntime}
        scenarioId={echoScenarioId}
        resonatorName={echoResonatorName}
        echoes={sourceEchoes}
        editable={echoEditable}
        canSaveEcho={canSaveEcho}
        onEchoes={onEchoLoadout}
        aside={modulationRoster.length > 0 ? (
          <>
            <MemberSelector roster={modulationRoster} memberId={modulationMemberId} onMember={onModulationMember} />
            {echoEditable ? <TeamEditButton scenarioId={echoScenarioId} /> : null}
          </>
        ) : null}
      />
      <div className="wk-echoes" {...echoSurfaceProps}>
        {Array.from({ length: 5 }, (_, index) => (
          <EchoCard
            key={index}
            echo={loadoutSlots[index] ?? null}
            sourceEcho={sourceEchoes[index] ?? null}
            index={index}
            selection={echoSelection}
            actions={echoActions}
            score={echoScores?.[index] ?? null}
            onOpen={onEchoOpen ? () => onEchoOpen(index) : undefined}
          />
        ))}
      </div>
    </section>
  )

  return (
    <div className="wk-main">
      <EvaluationBand report={report} score={score} grade={grade} tone={tone} />

      {echoLoadout}

      {modulationRuntime && modulationActRt && modulationAnalysisSource ? (
        <ModulationView
          runtime={modulationRuntime}
          actRt={modulationActRt}
          analysisSource={modulationAnalysisSource}
          isDark={modulationDark}
          onRtPdt={onModulationUpdate}
          view={modulationPanel}
          onView={setModulationPanel}
          roster={modulationRoster}
          memberId={modulationMemberId}
          onMember={onModulationMember}
          seatOut={seatOut}
          teamScenarioId={echoEditable ? echoScenarioId : null}
          activeBuild={evaluationMatchesModulationMember ? activeBuild : null}
          referenceBuild={evaluationMatchesModulationMember ? referenceBuild : null}
          maximumBuild={evaluationMatchesModulationMember ? maximumBuild : null}
          report={report}
          detailReport={detailReport}
          detailReportReady={detailReportReady}
          detailReportLoading={detailReportLoading}
          reportOpen={reportOpen}
          onReportOpen={onReportOpen}
          onReportClose={onReportClose}
        />
      ) : null}
    </div>
  )
}
