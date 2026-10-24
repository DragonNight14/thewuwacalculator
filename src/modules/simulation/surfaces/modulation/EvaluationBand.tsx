/*
  Author: Runor Ewhro
  description: shared evaluation score band used by every build-analysis page.
*/

import { GRADE_LADDER } from '@/engine/evaluation/grades.ts'
import type { EvaluationSummary } from '@/engine/evaluation/buildEvaluationWorkerTypes'
import {
  formatBuildEvaluationScore,
  getBuildEvaluationEmoji,
  getBuildEvaluationTone,
} from '@/modules/simulation/model/buildEvaluationDisplay.ts'
import { formatCompactNum } from '@/modules/simulation/model/statsView.ts'
import type { CssVars } from '@/modules/simulation/workspace/ui.tsx'

const GRADE_BLEND = 1.5

const GRADE_SCALE_GRADIENT = (() => {
  const asc = [...GRADE_LADDER].sort((a, b) => a[0] - b[0])
  const positions = asc.map(([threshold]) => Math.max(0, Math.min(100, threshold / 2)))
  const colors = asc.map(([threshold]) => getBuildEvaluationTone(threshold).color)
  const startColor = getBuildEvaluationTone(0).color

  const stops: string[] = [`${startColor} 0%`]
  for (let i = 0; i < positions.length; i += 1) {
    const pos = positions[i]
    const leftColor = i === 0 ? startColor : colors[i - 1]
    const prev = i === 0 ? 0 : positions[i - 1]
    const next = i + 1 < positions.length ? positions[i + 1] : 100
    const blend = Math.max(0, Math.min(GRADE_BLEND, (pos - prev) * 0.49, (next - pos) * 0.49))
    stops.push(`${leftColor} ${(pos - blend).toFixed(2)}%`)
    stops.push(`${colors[i]} ${(pos + blend).toFixed(2)}%`)
  }
  stops.push(`${colors[colors.length - 1]} 100%`)
  return `linear-gradient(90deg, ${stops.join(', ')})`
})()

const GRADE_MARKS = [...GRADE_LADDER]
  .sort((a, b) => a[0] - b[0])
  .map(([threshold, label]) => ({
    threshold,
    label,
    pos: Math.max(0, Math.min(100, threshold / 2)),
  }))

const MILESTONE_LABELS = new Set(['F', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS', 'SOLON?!'])
const MILESTONE_MARKS = GRADE_MARKS
  .filter((mark) => MILESTONE_LABELS.has(mark.label))
  .map((mark) => ({ ...mark, color: getBuildEvaluationTone(mark.threshold).color }))

const NO_READING = '--'

export function EvaluationBand({
  report,
  score,
  grade,
  tone,
}: {
  report: { evaluation: Omit<EvaluationSummary, 'percent'> } | null
  score: number | null
  grade: string | null
  tone: string
}) {
  const evaluation = report?.evaluation ?? null
  // the band remains mounted while a run is pending. unknown readings go quiet
  // and the marker hunts until the shared evaluation report resolves.
  const reading = !evaluation || score == null || grade == null
  const pct = reading ? 0 : Math.max(0, Math.min(100, score / 2))

  return (
    <section className="wk-band wk-card wk-span"
      data-state={reading ? 'reading' : undefined}
      data-emoji={reading ? undefined : getBuildEvaluationEmoji(grade)}
      data-score={reading ? undefined : Math.floor(score)}
      style={{
        ...(reading ? {} : { '--grade': tone, '--pos': `${pct}%` }),
        '--grade-scale': GRADE_SCALE_GRADIENT,
      } as CssVars}
    >
      <div className="wk-band-core">
        <div className="wk-band-score">
          <span className="wk-eyebrow">Build Score</span>
          <strong className="wk-band-figure">
            {reading ? null : formatBuildEvaluationScore(score)}
          </strong>
          <span className="wk-band-score-sub">
            {reading ? 'scoring... hang tight!' : (
              <>
                <em>{formatCompactNum(evaluation.userDamage)}</em> avg dmg
              </>
            )}
          </span>
        </div>
      </div>

      <div className="wk-band-gauge">
        <div className="wk-ruler-top">
          <span className="wk-ruler-dmg">
            <em>{evaluation ? formatCompactNum(evaluation.baselineDamage) : NO_READING}</em>
            <span>Baseline · 0%</span>
          </span>
          <span className="wk-ruler-dmg wk-ruler-dmg--mid">
            <em>{evaluation ? formatCompactNum(evaluation.referenceDamage) : NO_READING}</em>
            <span>Reference · 100%</span>
          </span>
          <span className="wk-ruler-dmg wk-ruler-dmg--end">
            <em>{evaluation ? formatCompactNum(evaluation.maximumDamage) : NO_READING}</em>
            <span>Maximum · 200%</span>
          </span>
        </div>

        <div className="wk-track">
          <span className="wk-track-bar">
            <span className="wk-track-scale" />
            <span className="wk-track-fill" />
            {GRADE_MARKS.map((mark) => (
              <span
                key={`${mark.threshold}:${mark.label}`} className="wk-track-notch"
                style={{ '--at': `${mark.pos}%` } as CssVars}
              />
            ))}
          </span>
          <span className="wk-track-tick wk-track-tick--mid" style={{ '--at': '50%' } as CssVars} />
          <span className="wk-track-marker">
            {reading ? null : <span className="wk-track-marker-flag">{grade}</span>}
          </span>
        </div>

        <div className="wk-ruler-tiers">
          <span className="wk-ruler-cap wk-ruler-cap--start">0%</span>
          {MILESTONE_MARKS.map((mark) => (
            <span
              key={`${mark.threshold}:${mark.label}`}
              className={`wk-ruler-tier${mark.pos <= pct ? ' is-reached' : ''}`}
              style={{ '--at': `${mark.pos}%`, '--tier-color': mark.color } as CssVars}
            >
              <i className="wk-ruler-tier-stem" aria-hidden="true" />
              <b>{mark.label}</b>
            </span>
          ))}
          <span className="wk-ruler-cap wk-ruler-cap--end">200%</span>
        </div>
      </div>
    </section>
  )
}
