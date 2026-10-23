/*
  Author: Runor Ewhro
  description: exposes the durable suggestion runners for main-stat,
               set-plan, and weapon workflows.
*/

import type {
  MainStatSugg,
  MainStatPrep,
  PrepSetPlanS,
  PrepWeaponPlan,
  SetPlanSugoi,
  WeaponEntry,
} from '@/engine/suggestions/types'
import { runPrepMainS } from '@/engine/suggestions/mainStat/suggest'
import { runPrepSetSg } from '@/engine/suggestions/setPlan/suggest'
import { runPrepWpn } from '@/engine/suggestions/weapon/compute'

export function runMainStats(
    input: MainStatPrep,
): MainStatSugg[] {
  return runPrepMainS(input)
}

export function runSetPlanqc(
    input: PrepSetPlanS,
): SetPlanSugoi {
  return runPrepSetSg(input)
}

export function runWpnSuggs(
    input: PrepWeaponPlan,
): WeaponEntry[] {
  return runPrepWpn(input)
}
