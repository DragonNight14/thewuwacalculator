/*
  Author: Runor Ewhro
  description: coordinates optimizer compilation, execution, result selection, preview, and application.
*/

import '@/styles/surfaces/optimizer/transport.css'
import type { ReactNode, Ref } from 'react'
import { ATTR_COLORS } from '@/modules/simulation/model/display'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import { getResonator } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { EvaluationBand } from '@/modules/simulation/surfaces/modulation/EvaluationBand.tsx'
import { useWorkspaceEvaluationSummary } from '@/modules/simulation/model/evaluationSummaryContext'
import {
  getBuildEvaluationGrade,
  getBuildEvaluationTone,
} from '@/modules/simulation/model/buildEvaluationDisplay.ts'
import { OptimizerEchoPreview } from '@/modules/simulation/surfaces/optimizer/transport/OptimizerEchoPreview.tsx'

export function OptimizerLab({
  resonatorId,
  resonatorName,
  runtime,
  previewKey,
  previewEchoes,
  bandFolded,
  bandRef,
  editable,
  onEquipPreview,
  children,
}: {
  resonatorId: string
  resonatorName: string
  runtime: ResRuntime | null
  previewKey: string
  previewEchoes: Array<EchoInstance | null>
  bandFolded: boolean
  bandRef?: Ref<HTMLDivElement>

  editable: boolean
  onEquipPreview: (echoes: Array<EchoInstance | null>) => void
  children: ReactNode
}) {
  const summary = useWorkspaceEvaluationSummary()
  const score = summary?.percent != null ? summary.percent * 100 : null
  const grade = getBuildEvaluationGrade(score)
  const subject = getResonator(resonatorId)
  const tone = score != null
    ? getBuildEvaluationTone(score).color
    : subject ? ATTR_COLORS[subject.attribute] : '#20bfb9'

  return (
    <main className="wk-main" data-phase="idle">
      <div ref={bandRef} className="opt-lab-band" data-folded={bandFolded ? '' : undefined}>
        <EvaluationBand report={summary ? { evaluation: summary } : null} score={score} grade={grade} tone={tone} />
      </div>

      {runtime ? (
        <OptimizerEchoPreview
          previewKey={previewKey}
          resonatorId={resonatorId}
          resonatorName={resonatorName}
          runtime={runtime}
          sourceEchoes={previewEchoes}
          editable={editable}
          onEquip={onEquipPreview}
        />
      ) : null}

      <section className="wk-section wk-span opt-lab-run">
        {children}
      </section>
    </main>
  )
}
