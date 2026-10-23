/*
  Author: Runor Ewhro
  description: compiles the optimizer payload for single target-skill mode
               by building the target context, encoding inventory echoes,
               and attaching the shared optimizer data needed for execution.
*/

import type { OptStartPay, PrepTargetSkill } from '@/engine/optimizer/types.ts'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters.ts'
import { encTgtStatCstrs } from '@/engine/search/score/statConstraints.ts'
import { mkMainEchoRo, encEchoRows } from '@/engine/search/encode/echoes.ts'
import { buildSetRows, makeSetMask } from '@/engine/search/encode/sets.ts'
import { compOptTgtCt } from '@/engine/search/context/target.ts'
import { mkShrdPay } from '@/engine/optimizer/compiler/shared.ts'
import { stripEchoes } from '@/engine/search/context/runtime.ts'

// compile the optimizer for a single selected target skill
// this is the main bridge from editable runtime state into the packed payload
// that later cpu and gpu execution paths consume
export function compTgtRun(input: OptStartPay, baseline = false): PrepTargetSkill {
  // optimizer candidates use inventory echoes with equipped echoes removed.
  const runtime = stripEchoes(input.runtime)

  // rebuild participant runtimes from the stripped runtime so target context
  // generation has the correct team-wide state available
  const participants = makeRuntimeMap(runtime, input.runtimesById)

  // compile the selected skill into the packed target context inputs
  const target = compOptTgtCt({
    runtime,
    resonatorId: input.resonatorId,
    resSeed: input.resSeed,
    skillId: input.settings.targetSkillId!,
    enemy: input.enemyProfile,
    runtimesById: participants,
    selectedTargets: input.selectedTargets,
  })

  // encode stat-floor and stat-cap style optimizer constraints from settings
  const constraints = baseline ? new Float32Array(0) : encTgtStatCstrs(input.settings)

  // encode the inventory echoes using the selected target skill shape
  const encoded = encEchoRows(input.invChs, target.selectedSkill, 'self')

  // build the shared payload used by both target and rotation optimizer modes
  const shared = mkShrdPay(encoded, input, constraints, baseline)

  // current runtime set state for evaluation's set merge
  const setRtMask = makeSetMask(runtime, input.setConds)
  const setConstLut = buildSetRows(runtime, input.setConds)

  // precompute main-echo buff rows for all inventory echoes against this selected skill
  const mainEchoBuffs = mkMainEchoRo({
    echoes: input.invChs,
    runtime,
    sourceBaseStats: target.combat.baseStats,
    sourceFinals: target.combat.finalStats,
    selectedSkill: target.selectedSkill,
  })

  return {
    mode: 'targetSkill',
    ...shared,
    runtime,
    skill: target.skill,
    selectedSkill: target.selectedSkill,
    sourceBaseStats: target.combat.baseStats,
    sourceFinals: target.combat.finalStats,
    compiled: target.compiled,
    setRtMask: setRtMask,
    stats: encoded.stats,
    setConstLut,
    mainEchoBuffs: mainEchoBuffs,
  }
}
