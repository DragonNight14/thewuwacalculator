/*
  Author: Runor Ewhro
  description: chooses which optimizer compilation pipeline to use
               based on whether the current optimizer settings are
               targeting a single skill or a full rotation run.
*/

import { makeOptSets } from '@/engine/runtime/defaults'
import type {
  PrepOptPay,
  OptStartPay,
} from '@/engine/optimizer/types.ts'
import { compTgtRun } from '@/engine/optimizer/compiler/target.ts'
import { compRotRun } from '@/engine/optimizer/compiler/rotation.ts'
import { compThryRot, compThryTgt } from '@/engine/optimizer/compiler/theory.ts'

// compile the raw optimizer start payload into the packed form that the
// execution layer expects.
//
// the decision is simple:
// - rotationMode = true -> build a rotation optimizer payload
// - rotationMode = false -> build a single-target-skill optimizer payload
export function compOptPay(
    input: OptStartPay,
): PrepOptPay {
  if (input.settings.searchMode === 'theory') {
    return input.settings.rotationMode
        ? compThryRot(input)
        : compThryTgt(input)
  }

  return input.settings.rotationMode
      ? compRotRun(input)
      : compTgtRun(input)
}

/** equipped-build evaluation shares the numeric compiler, without search metadata. */
export function compileBaseline(input: import('./compileWorker.types').OptBaselineInput): PrepOptPay {
  const request: OptStartPay = { ...input, settings: { ...makeOptSets(), ...input.settings, searchMode: 'inventory' } }
  return request.settings.rotationMode
    ? compRotRun(request, { baseline: true })
    : compTgtRun(request, true)
}
