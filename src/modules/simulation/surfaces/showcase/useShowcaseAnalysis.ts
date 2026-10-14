/*
  Author: Runor Ewhro
  description: publishes showcase damage before grading and releases results when the surface leaves.
*/
import { useEffect, useState } from 'react'
import { cancelEvaluationReport, runShowcaseAnalysis } from '@/engine/evaluation/buildEvaluationClient'
import { cacheEchoMainStatScoreProfile, activateEchoMainStatScoreProfile } from '@/engine/evaluation/echoScoring'
import type { ShowcaseAnalysisInput, ShowcaseAnalysisResult } from '@/engine/evaluation/showcaseAnalysis'

export function useShowcaseAnalysis(input: ShowcaseAnalysisInput | null, enabled = true) {
  const [completed, setCompleted] = useState<{ owner: string; value: ShowcaseAnalysisResult } | null>(null)
  useEffect(() => {
    let current = true
    if (!input) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- release the async result on departure.
      setCompleted(null)
      return
    }
    if (!enabled) return
    const owner = `${input.scenarioId}:${input.memberId}`
    // let the commit finish, then request damage without an idle/debounce delay.
    const timer = window.setTimeout(() => {
      void runShowcaseAnalysis(input, (progress) => {
        if (!current) return
        setCompleted((previous) => ({ owner, value: progress.stage === 'damage'
          ? { userDamage: progress.userDamage, percent: null, echoProfile: null }
          : { userDamage: previous?.owner === owner ? previous.value.userDamage : null, percent: progress.percent, echoProfile: null },
        }))
      }).then((value) => {
        if (!current) return
        const profile = value.echoProfile
        if (profile && !activateEchoMainStatScoreProfile(profile.charId, profile.cacheKey)) cacheEchoMainStatScoreProfile(profile)
        setCompleted({ owner, value })
      }).catch((error) => { if (current) console.error('Showcase analysis failed', error) })
    }, 0)
    return () => { current = false; window.clearTimeout(timer); cancelEvaluationReport() }
  }, [enabled, input])
  return input && completed?.owner === `${input.scenarioId}:${input.memberId}` ? completed.value : null
}
