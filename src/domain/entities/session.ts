/*
  Author: Runor Ewhro
  description: defines the legacy session projection retained for import and
               ui compatibility while CombatScenario stores live combat state.
*/

import type { EnemyProfile } from './appState'
import type { ResonatorId } from './runtime'

export interface CombatSession {
  /** @deprecated mirrors scenario member zero for legacy imports. */
  activeResonatorId: ResonatorId | null
  /** @deprecated mirrors CombatScenario.target for legacy imports. */
  enemyProfile: EnemyProfile
}
