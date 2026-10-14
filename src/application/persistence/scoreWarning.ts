/*
  Author: Runor Ewhro
  description: persists the versioned acknowledgement for the build score
               comparison warning.
*/

const SCORE_WARNING_STORE = 'seen-score-warning'
// a version change invalidates acknowledgements recorded for older guidance.
const SCORE_WARNING_VERSION = '1'

export function isScoreWarningSeen(): boolean {
  try {
    return localStorage.getItem(SCORE_WARNING_STORE) === SCORE_WARNING_VERSION
  } catch {
    return false
  }
}

export function markScoreWarningSeen(): void {
  try {
    localStorage.setItem(SCORE_WARNING_STORE, SCORE_WARNING_VERSION)
  } catch {
    // failed writes leave the acknowledgement unpersisted.
  }
}
