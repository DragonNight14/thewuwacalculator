/*
  Author: Runor Ewhro
  description: computes suggestion damage for main-stat recipe variants
               by applying recipe changes to equipped echoes and evaluating
               the resulting loadout.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import type { SuggestContext } from '@/engine/suggestions/types'
import { evalSuggChs, evalSuggChsW, mkSuggMainEc } from '@/engine/suggestions/shared'
import { MAIN_BUFF_LEN } from '@/engine/search/layout/constants'
import type { MainStatRecipe } from '@/engine/suggestions/mainStat/utils'
import { applyMainSta } from '@/engine/suggestions/mainStat/utils'
import { alignMainStatRecipes } from '@/engine/suggestions/mainStat/utils'
import { ECHO_MAIN_STATS } from '@/data/gameData/catalog/echoStats'
import { ECHO_STAT, ECHO_STAT_STRIDE } from '@/engine/search/layout/echoLayout'
import { encEchoRows } from '@/engine/search/encode/echoes'
import { prepareRotationBuildScorer } from '@/engine/rotation/candidateScorer'

export interface MainStatScorer {
  (recipes: MainStatRecipe[]): number
}

// evaluate damage after applying main-stat recipes to the current echo loadout
export function cmptMainStat(
    ctx: SuggestContext,
    recipes: MainStatRecipe[],
    qppdChs: Array<EchoInstance | null>,
): number {
  const echoes = applyMainSta(recipes, qppdChs)
  return evalSuggChs(ctx, echoes)
}

// rotation main-stat damage currently follows the same evaluation path
export function cmptRotMainS(
    ctx: SuggestContext,
    recipes: MainStatRecipe[],
    qppdChs: Array<EchoInstance | null>,
): number {
  return cmptMainStat(ctx, recipes, qppdChs)
}

/* the packed evaluator reads only the selected main echo's bonus row. its
   effect scope stays fixed during search; cache rows by echo body and stats. */
export function makeMainStatScorer(ctx: SuggestContext, equipped: Array<EchoInstance | null>): MainStatScorer {
  if (ctx.mode === 'rotation' && ctx.candidatePlan) {
    const plan = ctx.candidatePlan
    const layouts = new Map<string, { score: ReturnType<typeof prepareRotationBuildScorer>; base: Float32Array; secondary: Float64Array; subs: Float64Array; stats: Float32Array; slots: number[] }>()
    const score: MainStatScorer = (recipes) => {
      const key = recipes.map((recipe) => recipe.cost).join(',')
      let layout = layouts.get(key)
      if (!layout) {
        const shaped = applyMainSta(recipes, equipped), echoes = shaped.filter((echo): echo is EchoInstance => !!echo)
        const encoded = encEchoRows(echoes, ctx.selectedSkill, 'self')
        const base = new Float32Array(encoded.stats.length), secondary = new Float64Array(base.length), subs = secondary.slice()
        echoes.forEach((echo, row) => {
          const offset = row * ECHO_STAT_STRIDE
          if (Object.hasOwn(ECHO_STAT, echo.mainStats.secondary.key)) secondary[offset + ECHO_STAT[echo.mainStats.secondary.key as keyof typeof ECHO_STAT]] = echo.mainStats.secondary.value
          for (const stat in echo.substats) if (Object.hasOwn(ECHO_STAT, stat)) subs[offset + ECHO_STAT[stat as keyof typeof ECHO_STAT]] = echo.substats[stat]!
          for (let stat = 0; stat < ECHO_STAT_STRIDE; stat++) base[offset + stat] = Math.fround(secondary[offset + stat]!) + subs[offset + stat]!
        })
        layout = { score: prepareRotationBuildScorer(plan, { echoes, sets: encoded.sets, kinds: encoded.kinds,
          comboIds: Int32Array.from(echoes.map((_, row) => row)), mainIndex: Math.max(0, echoes.findIndex((echo) => echo.mainEcho)) }),
          base, secondary, subs, stats: base.slice(), slots: shaped.flatMap((echo, slot) => echo ? [slot] : []) }
        layouts.set(key, layout)
      }
      const aligned = alignMainStatRecipes(recipes, equipped)
      layout.stats.set(layout.base)
      layout.slots.forEach((slot, row) => {
        const recipe = aligned[slot]
        if (!recipe || !Object.hasOwn(ECHO_STAT, recipe.primaryKey)) return
        const column = ECHO_STAT[recipe.primaryKey as keyof typeof ECHO_STAT], index = row * ECHO_STAT_STRIDE + column
        layout!.stats[index] = Math.fround(Math.fround(Math.fround(ECHO_MAIN_STATS[recipe.cost]?.[recipe.primaryKey] ?? 0) + layout!.secondary[index]!) + layout!.subs[index]!)
      })
      return layout.score(layout.stats)
    }
    return score
  }
  const mainRows = new Map<string, Float32Array>()
  return (recipes: MainStatRecipe[]): number => {
    const echoes = applyMainSta(recipes, equipped)
    const concrete = echoes.filter((echo): echo is EchoInstance => echo != null)
    const mainIndex = Math.max(0, concrete.findIndex((echo) => echo.mainEcho))
    const main = concrete[mainIndex]
    if (!main) return 0
    const signature = JSON.stringify([main.id, main.set, main.mainStats, main.substats])
    let row = mainRows.get(signature)
    if (!row) {
      row = mkSuggMainEc(ctx, [main])
      mainRows.set(signature, row)
    }
    const buffs = new Float32Array(concrete.length * MAIN_BUFF_LEN)
    buffs.set(row, mainIndex * MAIN_BUFF_LEN)
    return evalSuggChsW(ctx, echoes, buffs)
  }
}
