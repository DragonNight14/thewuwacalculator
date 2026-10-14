/*
  Author: Runor Ewhro
  description: normalizes main-stat, set-plan, and weapon suggestions against
               their own baselines and materializes candidates for application.
*/

import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats.ts'
import { getSntSetClr, getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { applySetPlan, mkEchoMainSt } from '@/engine/suggestions/mutate.ts'
import { applyMainSta } from '@/engine/suggestions/mainStat-suggestion/utils.ts'
import type {
  CompactSetPlanSuggest,
  MainStatSugg,
  SetPlanDisplayEntry,
  SetPlanEntry,
  WeaponEntry,
} from '@/engine/suggestions/types.ts'
import type { MainStatRecipe } from '@/engine/suggestions/mainStat-suggestion/utils.ts'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/simulation/model/statsView.ts'
import { getRarityColor } from '@/modules/simulation/model/display.ts'
import { statIconSrc } from '@/modules/simulation/workspace/ui.tsx'
import { readSetTiers } from '@/modules/simulation/workspace/LoadoutEffects.tsx'
import { getEchoById } from '@/data/catalog/echoCatalogService.ts'
import {
  recipeSig,
  percentDiff,
  sortRecipes,
  type SetPlanSmmrE,
} from '@/modules/simulation/surfaces/suggestions/lib/suggestions.ts'
import { getSetPlanDisplay, groupWeaponSuggestions, sameSetPlanCandidate } from '../lib/results.ts'
import type { SuggKind } from '@/modules/simulation/surfaces/suggestions/lib/useSuggRuns.ts'

export { materializeWeaponSuggestion } from '../lib/results.ts'

export type Kind = 'mainStats' | 'setPlans' | 'weapons'

export const KINDS: Kind[] = ['mainStats', 'setPlans', 'weapons']

export const KIND_NAME: Record<Kind, string> = {
  mainStats: 'Main Stats',
  setPlans: 'Sonata Sets',
  weapons: 'Weapons',
}

export function isKind(mode: SuggKind): mode is Kind {
  return mode === 'mainStats' || mode === 'setPlans' || mode === 'weapons'
}

export interface Change {
  key: string
  icon: string | null
  text: string
  cost: string | null
  sup: string | null
  color: string | null
}

export interface EchoSlot {
  key: string
  color: string | null
  title: string
  lead: string
  leadUnit: string
  coins: Array<string | null>
  /** one name per coin for set trays, the stat name for main-stat trays. */
  names: string[]
  name: string | null
  primary: { icon: string | null; value: string } | null
  secondary: { icon: string | null; value: string } | null
  held: boolean
}

/* a weapon is scored per passive state; the lead variant ranks the row. */
export interface WeaponVariant {
  mode: WeaponEntry['mode']
  damage: number
  delta: number
}

export interface Row {
  key: string
  rank: number
  now: boolean
  /** already on the build: the worn recipe or set plan, or the weapon in hand. */
  equipped: boolean
  color: string | null
  damage: number
  delta: number
  marks: Change[]
  trays: EchoSlot[]
  recipe: MainStatRecipe[] | null
  setPlan: SetPlanEntry[] | null
  weapon: WeaponEntry | null
  variants: WeaponVariant[]
}

export interface WornMainStat {
  cost: number
  key: string
  value: number
  secondary: { key: string, value: number }
}

/* recipes have no slot identity, so compare equipped main stats as a multiset. */
export function wornMainStats(echoes: Array<EchoInstance | null>): WornMainStat[] {
  const out: WornMainStat[] = []
  for (const echo of echoes) {
    if (!echo) continue
    const cost = getEchoById(echo.id)?.cost
    if (!cost) continue
    out.push({ cost, key: echo.mainStats.primary.key, value: echo.mainStats.primary.value, secondary: echo.mainStats.secondary })
  }
  return out
}

function statMark(key: string, cost: number): Change {
  const value = ECHO_MAIN_STATS[cost]?.[key] ?? 0
  return {
    key: `${cost}:${key}`,
    icon: statIconSrc(key),
    text: `Cost ${cost}, ${formatStatKeyLabel(key)} ${formatStatKeyValue(key, value)}`,
    cost: `${cost}c`,
    sup: null,
    color: null,
  }
}

function statTray(key: string, cost: number, held: boolean): EchoSlot {
  const value = ECHO_MAIN_STATS[cost]?.[key] ?? 0
  const side = ECHO_SIDE_STATS[cost]
  return {
    key: `${cost}:${key}`,
    color: null,
    title: `Cost ${cost}, ${formatStatKeyLabel(key)} ${formatStatKeyValue(key, value)}`,
    lead: String(cost),
    leadUnit: 'c',
    coins: [],
    names: [formatStatKeyLabel(key)],
    name: null,
    primary: { icon: statIconSrc(key), value: formatStatKeyValue(key, value) },
    secondary: side
      ? { icon: statIconSrc(side.key), value: formatStatKeyValue(side.key, side.value) }
      : null,
    held,
  }
}

/* consume matching multiset entries so repeated cost/stat pairs remain distinct. */
function mainStatRows(
  results: MainStatSugg[],
  base: number,
  echoes: Array<EchoInstance | null>,
  worn: WornMainStat[],
): Row[] {
  return results.map((result, index) => {
    const have = new Map<string, number>()
    for (const entry of worn) {
      const side = ECHO_SIDE_STATS[entry.cost]
      if (entry.value !== ECHO_MAIN_STATS[entry.cost]?.[entry.key]
        || entry.secondary.key !== side?.key || entry.secondary.value !== side?.value) continue
      const key = `${entry.cost}:${entry.key}`
      have.set(key, (have.get(key) ?? 0) + 1)
    }

    const recipes = sortRecipes(result.recipes)
    const marks: Change[] = []
    const trays: EchoSlot[] = []

    for (const recipe of recipes) {
      const key = `${recipe.cost}:${recipe.primaryKey}`
      const left = have.get(key) ?? 0
      const held = left > 0
      if (held) have.set(key, left - 1)
      if (!held) marks.push(statMark(recipe.primaryKey, recipe.cost))
      trays.push(statTray(recipe.primaryKey, recipe.cost, held))
    }

    const now = recipeSig(result.recipes) === mkEchoMainSt(echoes)
    return {
      key: `main:${index}`,
      rank: index + 1,
      now,
      equipped: now,
      color: null,
      damage: result.damage,
      delta: percentDiff(result.damage, base),
      marks,
      trays,
      recipe: result.recipes,
      setPlan: null,
      weapon: null,
      variants: [],
    }
  })
}

/* a row's slots list effect-equivalent sets that the engine scored alike.
   prefer the ones already worn so materializing the plan changes as few echoes
   as possible. ties keep the engine's pick. concrete entries outside these
   slots change no scored effect, so their echoes remain worn. */
export function preferWornSets(
  display: SetPlanDisplayEntry[],
  concrete: SetPlanEntry[],
  worn: SetPlanSmmrE[],
): { setPlan: SetPlanEntry[], display: SetPlanDisplayEntry[] } {
  const have = new Map<number, number>()
  for (const entry of worn) have.set(entry.setId, (have.get(entry.setId) ?? 0) + entry.pieces)

  // pair each display slot with the concrete entry it was drawn from.
  const taken = new Set<number>()
  const slots = display.map((entry) => {
    const at = concrete.findIndex((plan, index) => (
      !taken.has(index) && plan.pieces === entry.pieces && entry.setIds.includes(plan.setId)
    ))
    if (at >= 0) taken.add(at)
    return at
  })

  let best: number[] | null = null
  let bestScore = -1
  const pick: number[] = []
  const walk = (slot: number) => {
    if (slot === display.length) {
      let score = 0
      pick.forEach((setId, index) => {
        score += Math.min(have.get(setId) ?? 0, display[index].pieces) * 100
        if (slots[index] >= 0 && concrete[slots[index]].setId === setId) score += 1
      })
      if (score > bestScore) { bestScore = score; best = [...pick] }
      return
    }
    for (const setId of display[slot].setIds) {
      // each slot is its own bonus: two slots never share one set.
      if (pick.includes(setId)) continue
      pick.push(setId)
      walk(slot + 1)
      pick.pop()
    }
  }
  walk(0)
  const chosen: number[] | null = best
  // unpaired slots mean the display is not drawn from this plan; keep it whole.
  if (!chosen || slots.includes(-1)) return { setPlan: concrete, display }

  // worn echoes left in free slots add to whatever set they carry. never let
  // them lift a set over a tier the scored plan did not reach.
  const crossesTier = (plan: SetPlanEntry[]) => {
    const free = Math.max(0, 5 - plan.reduce((total, entry) => total + entry.pieces, 0))
    return [...have].some(([setId, pieces]) => {
      const planned = plan.reduce((total, entry) => total + (entry.setId === setId ? entry.pieces : 0), 0)
      const most = planned + Math.min(pieces, free)
      return (readSetTiers(setId)?.tiers ?? []).some((tier) => planned < tier.pieces && most >= tier.pieces)
    })
  }
  const swapped = display.map((entry, index) => ({ setId: chosen[index], pieces: entry.pieces }))
  const fillers = concrete.filter((_, index) => !taken.has(index))
  const setPlan = !crossesTier(swapped) ? swapped
    : !crossesTier([...swapped, ...fillers]) ? [...swapped, ...fillers]
      : null
  if (!setPlan) return { setPlan: concrete, display }
  // put the materialized set first while retaining its effect-equivalent alternatives.
  const led = display.map((entry, index) => ({
    ...entry,
    setIds: [chosen[index], ...entry.setIds.filter((id) => id !== chosen[index])],
  }))
  return { setPlan, display: led }
}

function setPlanRows(
  results: CompactSetPlanSuggest[],
  base: number,
  worn: SetPlanSmmrE[],
): Row[] {
  return results.map((result, index) => {
    const have = new Map<number, number>()
    for (const entry of worn) {
      have.set(entry.setId, (have.get(entry.setId) ?? 0) + entry.pieces)
    }

    const { setPlan, display: displayPlan } = preferWornSets(getSetPlanDisplay(result), result.setPlan, worn)

    const marks: Change[] = []
    const trays: EchoSlot[] = []

    for (const entry of displayPlan) {
      const lead = entry.setIds[0]
      const held = (have.get(lead) ?? 0) >= entry.pieces
      if (held) have.set(lead, (have.get(lead) ?? 0) - entry.pieces)
      const color = getSntSetClr(lead)
      if (!held) {
        marks.push({
          key: `${lead}:${entry.pieces}`,
          icon: getSntSetIco(lead),
          text: `${entry.setIds.map((id) => getSntSetNam(id)).join(' or ')}, ${entry.pieces}pc`,
          cost: null,
          sup: String(entry.pieces),
          color,
        })
      }
      trays.push({
        key: `${lead}:${entry.pieces}`,
        color,
        title: `${entry.pieces}pc ${entry.setIds.map((id) => getSntSetNam(id)).join(' or ')}`,
        lead: String(entry.pieces),
        leadUnit: 'pc',
        coins: entry.setIds.map((id) => getSntSetIco(id)),
        names: entry.setIds.map((id) => getSntSetNam(id)),
        name: getSntSetNam(lead),
        primary: null,
        secondary: null,
        held,
      })
    }

    const now = sameSetPlanCandidate(result, worn, base)
    return {
      key: `sets:${index}`,
      rank: index + 1,
      now,
      equipped: now,
      color: null,
      damage: result.avgDamage,
      delta: percentDiff(result.avgDamage, base),
      marks,
      trays,
      recipe: null,
      setPlan,
      weapon: null,
      variants: [],
    }
  })
}

/* fold passive variants by weapon while keeping the configured ranking variant first. */
function weaponRows(
  results: WeaponEntry[],
  base: number,
  runtime: ResRuntime,
): Row[] {
  return groupWeaponSuggestions(results).map(({ plans }, index) => {
    const lead = plans[0]
    const now = lead.weaponId === runtime.build.weapon.id
    const color = getRarityColor(lead.rarity) ?? null
    return {
      key: `weapon:${index}:${lead.weaponId}`,
      rank: index + 1,
      now,
      equipped: lead.weaponId === runtime.build.weapon.id,
      color,
      damage: lead.damage,
      delta: percentDiff(lead.damage, base),
      marks: [{
        key: lead.weaponId,
        icon: lead.icon,
        text: lead.name,
        cost: null,
        sup: null,
        color,
      }],
      trays: plans.map((plan) => ({
        key: `${plan.weaponId}:${plan.mode}`,
        color: null,
        title: `${plan.mode === 'max' ? 'Stacked' : 'Resting'} passive, ${plan.pssvName}`,
        lead: plan.mode === 'max' ? 'MAX' : 'REST',
        leadUnit: '',
        coins: [],
        names: [],
        name: null,
        primary: { icon: null, value: `${plan.damage > base ? '+' : ''}${percentDiff(plan.damage, base).toFixed(1)}%` },
        secondary: null,
        held: false,
      })),
      recipe: null,
      setPlan: null,
      weapon: lead,
      variants: plans.map((plan) => ({
        mode: plan.mode,
        damage: plan.damage,
        delta: percentDiff(plan.damage, base),
      })),
    }
  })
}

export function buildRows({
  kind,
  mainStatRslt,
  setPlanRslt,
  wpnRslt,
  base,
  echoes,
  worn,
  wornSetPlan,
  runtime,
}: {
  kind: Kind
  mainStatRslt: MainStatSugg[]
  setPlanRslt: CompactSetPlanSuggest[]
  wpnRslt: WeaponEntry[]
  base: number
  echoes: Array<EchoInstance | null>
  worn: WornMainStat[]
  wornSetPlan: SetPlanSmmrE[]
  runtime: ResRuntime
}): Row[] {
  if (kind === 'mainStats') return mainStatRows(mainStatRslt, base, echoes, worn)
  if (kind === 'setPlans') return setPlanRows(setPlanRslt, base, wornSetPlan)
  return weaponRows(wpnRslt, base, runtime)
}

export function materializeRowEchoes(row: Row, echoes: Array<EchoInstance | null>): Array<EchoInstance | null> | null {
  if (row.recipe) return applyMainSta(row.recipe, echoes)
  if (row.setPlan) return applySetPlan(row.setPlan, echoes)
  return null
}
