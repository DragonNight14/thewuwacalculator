/*
  Author: Runor Ewhro
  description: shares grouped-result display and weapon grouping between surfaces
               and materializes scored weapon candidates.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { clrSrcCtrls } from '@/engine/runtime/sourceStateInit.ts'
import type { CompactSetPlanSuggest, SetPlanDisplayEntry, WeaponEntry } from '@/engine/suggestions/types.ts'
import { setPlnsQl, type SetPlanSmmrE } from './suggestions.ts'

export function getSetPlanDisplay(plan: CompactSetPlanSuggest): SetPlanDisplayEntry[] {
  return plan.displayPlan?.length
    ? plan.displayPlan
    : plan.setPlan.map((entry) => ({ setIds: [entry.setId], pieces: entry.pieces }))
}

/* grouping can choose a concrete representative other than the worn plan.
   match distinct worn bonuses to the displayed effect-equivalent slots. */
export function sameSetPlanCandidate(result: CompactSetPlanSuggest, worn: SetPlanSmmrE[], base: number): boolean {
  const tolerance = Math.max(1e-6, Math.abs(result.avgDamage) * 1e-6, Math.abs(base) * 1e-6)
  if (Math.abs(result.avgDamage - base) > tolerance) return false
  if (setPlnsQl(result.setPlan, worn)) return true
  const slots = getSetPlanDisplay(result)
  if (slots.length === 0) return false
  const used = new Set<number>()
  const match = (slot: number): boolean => {
    if (slot === slots.length) return true
    const entry = slots[slot]
    for (let index = 0; index < worn.length; index += 1) {
      if (used.has(index) || worn[index].pieces < entry.pieces || !entry.setIds.includes(worn[index].setId)) continue
      used.add(index)
      if (match(slot + 1)) return true
      used.delete(index)
    }
    return false
  }
  return match(0)
}

export function groupWeaponSuggestions(results: WeaponEntry[]): Array<{ id: string, plans: WeaponEntry[] }> {
  const groups = new Map<string, WeaponEntry[]>()
  for (const plan of results) {
    const plans = groups.get(plan.weaponId) ?? []
    plans.push(plan)
    groups.set(plan.weaponId, plans)
  }
  return [...groups].map(([id, plans]) => ({ id, plans }))
}

/* apply the exact candidate scored by the engine. states omitted by weapon
   config remain absent through global initialization and control merging. */
export function materializeWeaponSuggestion(
  runtime: ResRuntime,
  plan: WeaponEntry,
): ResRuntime {
  const controls = { ...runtime.state.controls }
  clrSrcCtrls(controls, { type: 'weapon', id: runtime.build.weapon.id })
  clrSrcCtrls(controls, { type: 'weapon', id: plan.weaponId })
  Object.assign(controls, plan.controls)

  return {
    ...runtime,
    build: {
      ...runtime.build,
      weapon: {
        id: plan.weaponId,
        level: plan.level,
        rank: plan.rank,
        baseAtk: plan.baseAtk,
      },
    },
    state: {
      ...runtime.state,
      controls,
    },
  }
}
