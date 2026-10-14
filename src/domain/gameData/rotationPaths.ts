/*
  Author: Runor Ewhro
  description: canonical runtime paths both rotation surfaces use for handoffs
               and target routing, so string literals cannot drift apart.
*/

/** condition writes that change the active field character during a rotation. */
export const ACTIVE_RESONATOR_PATH = 'runtime.rotation.activeResonatorId'

/** prefix for per-state target routing control paths. */
export const SELECTED_TARGET_PATH_PREFIX = 'runtime.routing.selectedTargetsByOwnerKey.'
