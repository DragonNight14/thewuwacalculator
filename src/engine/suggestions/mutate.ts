/*
  Author: Runor Ewhro
  description: builds, mutates, and validates durable main-stat and set-plan
               suggestion echo loadouts.
*/

import type { EchoDef } from '@/domain/entities/catalog'
import type { EchoInstance } from '@/domain/entities/runtime'
import { makeEchoUid } from '@/domain/entities/runtime'
import { getEchoById, getEchoSets, listEchoes, listChsByCos } from '@/data/catalog/echoCatalogService'
import {
  ECHO_MAIN_STATS,
  ECHO_SIDE_STATS,
} from '@/data/gameData/catalog/echoStats'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import type { OptStatWeight } from '@/engine/search/score/statWeights.ts'
import type { SetPlanEntry } from '@/engine/search/combos/setPlans'
import { MAIN_STAT_IDS } from '@/engine/suggestions/mainStat/filterOrder.ts'

// elemental bonus main stats are handled as a grouped "bonus" filter,
// but we still need to know the individual keys when resolving the best one.
const ELEMENT_KEYS = new Set(['aero', 'glacio', 'fusion', 'spectro', 'havoc', 'electro'])

// resolve thresholds when building a plan because definitions load after import.
function setThreshold(setId: number): number {
  const max = ECHO_SET_DEFS.find((entry) => entry.id === setId)?.setMax
  return max === 1 ? 1 : max === 3 ? 3 : 2
}

export type SuggMainStat = (typeof MAIN_STAT_IDS)[number]

export interface SuggMainStsc {
  allowedFilter: Set<SuggMainStat>
  selBonus: string | null
}

type SetCostAvailability = Map<number, Map<number, Set<string>>>
let setAvailCache: SetCostAvailability | null = null

function getSetAvail(): SetCostAvailability {
  if (setAvailCache) return setAvailCache

  const availability: SetCostAvailability = new Map()
  for (const echo of listEchoes()) {
    for (const setId of echo.sets) {
      const byCost = availability.get(setId) ?? new Map<number, Set<string>>()
      const ids = byCost.get(echo.cost) ?? new Set<string>()
      ids.add(echo.id)
      byCost.set(echo.cost, ids)
      availability.set(setId, byCost)
    }
  }
  setAvailCache = availability
  return availability
}

// resolve the catalog cost for a runtime echo instance
function getEchoCost(echo: EchoInstance | null | undefined): number | null {
  if (!echo) {
    return null
  }

  return getEchoById(echo.id)?.cost ?? null
}

// clone an echo and assign a fresh uid so suggestion outputs remain distinct
function cloneEchoWit(echo: EchoInstance, slotIndex: number): EchoInstance {
  return {
    uid: makeEchoUid(),
    id: echo.id,
    set: echo.set,
    mainEcho: slotIndex === 0,
    mainStats: {
      primary: { ...echo.mainStats.primary },
      secondary: { ...echo.mainStats.secondary },
    },
    substats: { ...echo.substats },
  }
}

// build a brand-new echo instance from a catalog definition,
// while allowing the caller to force set, primary stat, and substats
function mkEchoNstnyk(
    definition: EchoDef,
    options: {
      slotIndex: number
      setId?: number | null
      primaryKey: string
      substats?: Record<string, number>
    },
): EchoInstance {
  const secondary = ECHO_SIDE_STATS[definition.cost]

  return {
    uid: makeEchoUid(),
    id: definition.id,
    set: options.setId && definition.sets.includes(options.setId)
        ? options.setId
        : definition.sets[0] ?? 0,
    mainEcho: options.slotIndex === 0,
    mainStats: {
      primary: {
        key: options.primaryKey,
        value: ECHO_MAIN_STATS[definition.cost]?.[options.primaryKey] ?? 0,
      },
      secondary: {
        key: secondary?.key ?? 'atkFlat',
        value: secondary?.value ?? 0,
      },
    },
    substats: { ...(options.substats ?? {}) },
  }
}

// convert internal stat keys into main-stat filter labels
function mapWghtKeyei(
    key: string,
): SuggMainStat | null {
  if (key === 'atkPercent') return 'atk%'
  if (key === 'hpPercent') return 'hp%'
  if (key === 'defPercent') return 'def%'
  if (key === 'energyRegen') return 'er'
  if (key === 'critRate') return 'cr'
  if (key === 'critDmg') return 'cd'
  if (key === 'healingBonus') return 'healing'
  if (ELEMENT_KEYS.has(key)) return 'bonus'
  return null
}

// derive the allowed main-stat filter set from optimizer weights.
// elemental bonuses are collapsed into a single filter, but the strongest
// element is still remembered so later picks can favor the correct one.
export function derSuggMainS(
    weights: OptStatWeight,
    resonatorId: string,
): SuggMainStsc {
  const allowedFilter = new Set<SuggMainStat>()
  let selectedBonus: string | null = null
  let bestBnsWght = 0

  for (const [key, value] of Object.entries(weights)) {
    if ((value ?? 0) <= 0) {
      continue
    }

    const filterKey = mapWghtKeyei(key)
    if (filterKey) {
      allowedFilter.add(filterKey)
    }

    // among all element bonus keys, keep the one with the largest weight
    if (ELEMENT_KEYS.has(key) && (value ?? 0) > bestBnsWght) {
      bestBnsWght = value ?? 0
      selectedBonus = key
    }
  }

  // special-case characters that often want er in the option pool
  const numericId = Number.parseInt(resonatorId, 10)
  if (numericId === 1206 || numericId === 1209 || numericId === 1412 || numericId === 1505 || numericId == 1110) {
    allowedFilter.add('er')
  }

  return {
    allowedFilter: allowedFilter,
    selBonus: selectedBonus,
  }
}

// build the valid primary main-stat choices for a given echo cost,
// filtered by the current suggestion config if one exists.
export function mkMainStatPt(
    cost: number,
    config: SuggMainStsc,
): Array<{ key: string; value: number }> {
  const valid = ECHO_MAIN_STATS[cost] ?? {}
  const entries = Object.entries(valid)

  // no filter means every valid main stat for this cost is allowed
  if (config.allowedFilter.size === 0) {
    return entries.map(([key, value]) => ({ key, value }))
  }

  const filtered = entries.filter(([key]) => {
    const filterKey = mapWghtKeyei(key)
    if (!filterKey || !config.allowedFilter.has(filterKey)) {
      return false
    }

    // when bonus is selected, only keep the strongest chosen element
    if (filterKey === 'bonus' && config.selBonus) {
      return key === config.selBonus
    }

    return true
  })

  // if filtering becomes too strict, fall back to all valid options
  return (filtered.length > 0 ? filtered : entries).map(([key, value]) => ({ key, value }))
}

// apply a chosen primary main-stat layout onto already-equipped echoes
// while preserving their identities, sets, and substats where possible.
export function applyMainSur(
    qppdChs: Array<EchoInstance | null>,
    prmrKeysBySl: Array<string | null>,
): Array<EchoInstance | null> {
  return qppdChs.map((echo, slotIndex) => {
    if (!echo) {
      return null
    }

    const key = prmrKeysBySl[slotIndex]
    if (!key) {
      return cloneEchoWit(echo, slotIndex)
    }

    const definition = getEchoById(echo.id)
    const cost = definition?.cost ?? getEchoCost(echo)
    if (!cost) {
      return cloneEchoWit(echo, slotIndex)
    }

    return {
      ...cloneEchoWit(echo, slotIndex),
      mainStats: {
        primary: {
          key,
          value: ECHO_MAIN_STATS[cost]?.[key] ?? echo.mainStats.primary.value,
        },
        secondary: {
          ...ECHO_SIDE_STATS[cost],
        },
      },
    }
  })
}

// match requested set pieces to the available slot costs. A positional fill
// can assign a set to a cost where no Echo of that set exists.
function xpndSetPlanT(
    setPlan: SetPlanEntry[],
    qppdChs: Array<EchoInstance | null>,
    mainIndex = 0,
    mainSetId?: number,
): Array<number | null> | null {
  const targets = new Array<number | null>(qppdChs.length).fill(null)
  const pieces = setPlan.flatMap((entry) => Array.from({ length: Math.max(0, entry.pieces) }, () => entry.setId))
  if (pieces.length === 0) return targets
  const available = getSetAvail()
  const mainEcho = qppdChs[mainIndex]
  const costs = qppdChs.map(getEchoCost)
  const supportedSets = qppdChs.map(echo => echo ? getEchoSets(echo.id) : [])
  const preferredMainSet = mainSetId ?? setPlan.find((entry) =>
    mainEcho && supportedSets[mainIndex]!.includes(entry.setId))?.setId

  const solve = (reserveMain: boolean): Array<number | null> | null => {
    const assigned = [...targets]
    const remaining = [...pieces]
    const assignedByCost = new Map<string, number>()
    if (reserveMain && preferredMainSet != null) {
      const pieceIndex = remaining.indexOf(preferredMainSet)
      if (pieceIndex < 0 || !mainEcho || !supportedSets[mainIndex]!.includes(preferredMainSet)) return null
      assigned[mainIndex] = preferredMainSet
      assignedByCost.set(`${preferredMainSet}:${costs[mainIndex]}`, 1)
      remaining.splice(pieceIndex, 1)
    }
    const excludedMain = mainSetId != null && !reserveMain
    const options = remaining.map((setId) => ({
      setId,
      slots: qppdChs.flatMap((echo, index) => {
        if (!echo || assigned[index] != null || (excludedMain && index === mainIndex)) return []
        const cost = costs[index]
        return cost && available.get(setId)?.get(cost)?.size ? [index] : []
      }).sort((left, right) =>
        Number(!supportedSets[left]!.includes(setId))
          - Number(!supportedSets[right]!.includes(setId))
          || left - right),
    })).sort((left, right) => left.slots.length - right.slots.length)
    const used = new Set<number>()
    const assign = (index: number): boolean => {
      if (index === options.length) return true
      const option = options[index]
      for (const slot of option.slots) {
        if (used.has(slot)) continue
        const key = `${option.setId}:${costs[slot]}`
        const count = assignedByCost.get(key) ?? 0
        // two same-cost slots still need distinct catalog bodies in a set.
        if (count >= (available.get(option.setId)?.get(costs[slot]!)?.size ?? 0)) continue
        assignedByCost.set(key, count + 1)
        used.add(slot)
        assigned[slot] = option.setId
        if (assign(index + 1)) return true
        assigned[slot] = null
        used.delete(slot)
        assignedByCost.set(key, count)
      }
      return false
    }
    return assign(0) ? assigned : null
  }

  if (mainSetId != null) return solve(pieces.includes(mainSetId))
  return (preferredMainSet != null ? solve(true) : null) ?? solve(false)
}

// choose a replacement echo definition that matches both set and cost if possible
const templateCandidates = new WeakMap<EchoDef[], Map<string, EchoDef[]>>()
function pickTmplDefF(
    setId: number,
    cost: number | null,
    usedKeys: Set<string>,
): EchoDef | null {
  const catalog = listEchoes(), key = `${cost ?? 0}:${setId}`
  let byShape = templateCandidates.get(catalog)
  if (!byShape) { byShape = new Map(); templateCandidates.set(catalog, byShape) }
  let candidates = byShape.get(key)
  if (!candidates) {
    candidates = (cost ? listChsByCos(cost) : catalog).filter(entry => entry.sets.includes(setId))
    byShape.set(key, candidates)
  }

  // an id is only "used up" for this set; the same id is still free for others.
  return candidates.find(entry => !usedKeys.has(echoSetKey(entry.id, setId))) ?? candidates[0] ?? null
}

// choose a replacement echo definition that avoids activating forbidden sets
function pickRplcDef(
    cost: number | null,
    avoidSetIds: Set<number>,
    usedKeys: Set<string>,
): { definition: EchoDef; setId: number } | null {
  const candidates = cost ? listChsByCos(cost) : listEchoes()
  // check each supported set because a body can also provide a valid filler set.
  for (const definition of candidates) {
    for (const setId of definition.sets) {
      if (avoidSetIds.has(setId) || setThreshold(setId) === 1
        || usedKeys.has(echoSetKey(definition.id, setId))) continue
      return { definition, setId }
    }
  }
  return null
}

// after applying a plan, remove accidental over-activation of planned or unplanned sets
function normSetSlct(
    echoes: Array<EchoInstance | null>,
    setPlan: SetPlanEntry[],
    usedKeys: Set<string>,
    mainEchoChoice?: { id: string; setId: number },
): Array<EchoInstance | null> {
  const planCounts = new Map(setPlan.map((entry) => [entry.setId, entry.pieces]))
  const result = echoes.map((echo, slotIndex) => (
      echo ? cloneEchoWit(echo, slotIndex) : null
  ))

  const cntNdcsBySet = () => {
    const setMap = new Map<number, number[]>()

    result.forEach((echo, index) => {
      if (!echo) {
        return
      }

      const indices = setMap.get(echo.set) ?? []
      indices.push(index)
      setMap.set(echo.set, indices)
    })

    return setMap
  }

  // replace one echo in a problematic set with a same-cost echo
  // that avoids all currently planned sets plus the set being broken.
  const rplcAtNdx = (setIdToBreak: number, index: number): boolean => {
    const original = result[index]
    if (!original) {
      return false
    }

    const avoid = new Set([...planCounts.keys(), setIdToBreak])
    for (const [setId, indices] of cntNdcsBySet()) {
      if (indices.length >= setThreshold(setId) - 1) avoid.add(setId)
    }
    const replacement = pickRplcDef(
        getEchoCost(original),
        avoid,
        usedKeys,
    )

    if (!replacement) {
      return false
    }

    const { definition, setId } = replacement
    usedKeys.add(echoSetKey(definition.id, setId))
    result[index] = {
      ...mkEchoNstnyk(definition, {
        slotIndex: index,
        setId,
        primaryKey: original.mainStats.primary.key,
        substats: original.substats,
      }),
      mainStats: {
        primary: { ...original.mainStats.primary },
        secondary: { ...original.mainStats.secondary },
      },
    }
    return true
  }

  let counts = cntNdcsBySet()

  // first enforce exact or capped counts for sets explicitly in the plan
  for (const [setId, desired] of planCounts.entries()) {
    const indices = counts.get(setId) ?? []
    if (indices.length <= desired) {
      continue
    }

    let toRemove = indices.length - desired

    // prefer replacing non-main slots first
    for (const index of [...indices].sort((left, right) => Number(left === 0) - Number(right === 0))) {
      if (toRemove <= 0) {
        break
      }

      if (index === 0 && indices.length > 1) {
        continue
      }

      if (rplcAtNdx(setId, index)) toRemove -= 1
    }
  }

  counts = cntNdcsBySet()

  // then break any accidental set activation for sets not in the plan
  for (const [setId, indices] of counts.entries()) {
    if (planCounts.has(setId)) {
      continue
    }

    const threshold = setThreshold(setId)
    const allowedMax = threshold - 1

    if (indices.length <= allowedMax) {
      continue
    }

    let toFix = indices.length - allowedMax

    for (const index of [...indices].sort((left, right) => Number(left === 0) - Number(right === 0))) {
      if (toFix <= 0) {
        break
      }

      if (index === 0 && mainEchoChoice) {
        continue
      }
      if (index === 0 && indices.length > 1) {
        continue
      }

      if (rplcAtNdx(setId, index)) toFix -= 1
    }
  }

  return result
}

function echoSetKey(id: string, set: number): string {
  return `${id}|${set}`
}

// apply a set plan onto the current equipped echoes, preserving
// originals when compatible and swapping in matching templates when needed.
export function applySetPlan(
    setPlan: SetPlanEntry[],
    qppdChs: Array<EchoInstance | null>,
    mainEchoChoice?: { id: string; setId: number },
): Array<EchoInstance | null> {
  let sourceEchoes = qppdChs
  let orderedPlan = setPlan
  if (mainEchoChoice) {
    const definition = getEchoById(mainEchoChoice.id)
    const mainIndex = definition && definition.sets.includes(mainEchoChoice.setId)
      ? qppdChs.findIndex((echo) => getEchoCost(echo) === definition.cost)
      : -1
    // a main body must use an existing slot of its cost. move that whole
    // slot, including its stats, so changing main never changes the build.
    if (mainIndex < 0) return qppdChs.map((echo, index) => echo ? cloneEchoWit(echo, index) : null)
    const reordered = [...qppdChs]
    const previousMain = reordered[0]!
    reordered[0] = reordered[mainIndex]!
    reordered[mainIndex] = previousMain
    sourceEchoes = reordered.map((echo, index) => index === 0 && echo
      ? { ...echo, id: mainEchoChoice.id, set: mainEchoChoice.setId }
      : echo)
    const preferred = setPlan.find((entry) => entry.setId === mainEchoChoice.setId)
    if (preferred) {
      orderedPlan = [preferred, ...setPlan.filter((entry) => entry !== preferred)]
    }
  }

  const targetSets = xpndSetPlanT(orderedPlan, sourceEchoes, 0, mainEchoChoice?.setId)
  if (!targetSets) return sourceEchoes.map((echo, index) => echo ? cloneEchoWit(echo, index) : null)
  const usedKeys = new Set<string>()
  const result: Array<EchoInstance | null> = []

  for (let slotIndex = 0; slotIndex < sourceEchoes.length; slotIndex += 1) {
    const original = sourceEchoes[slotIndex]
    const targetSet = targetSets[slotIndex]

    if (!original) {
      result.push(null)
      continue
    }

    // no set assignment for this slot means keep the original echo body
    if (targetSet == null) {
      result.push(cloneEchoWit(original, slotIndex))
      usedKeys.add(echoSetKey(original.id, original.set))
      continue
    }

    const originalSets = getEchoSets(original.id)

    // if the original echo already supports the target set and that id|set pair
    // hasn't been reused, keep it and just rewrite the active set id.
    if (originalSets.includes(targetSet) && !usedKeys.has(echoSetKey(original.id, targetSet))) {
      result.push({
        ...cloneEchoWit(original, slotIndex),
        set: targetSet,
      })
      usedKeys.add(echoSetKey(original.id, targetSet))
      continue
    }

    // otherwise swap in a compatible template of the same cost if possible
    const rplcDef = pickTmplDefF(targetSet, getEchoCost(original), usedKeys)
    if (!rplcDef) {
      // an unrealizable plan must never produce a body with an unsupported set.
      result.push(cloneEchoWit(original, slotIndex))
      continue
    }

    usedKeys.add(echoSetKey(rplcDef.id, targetSet))
    result.push({
      ...mkEchoNstnyk(rplcDef, {
        slotIndex,
        setId: targetSet,
        primaryKey: original.mainStats.primary.key,
        substats: original.substats,
      }),
      mainStats: {
        primary: { ...original.mainStats.primary },
        secondary: { ...original.mainStats.secondary },
      },
    })
  }

  return normSetSlct(result, orderedPlan, usedKeys, mainEchoChoice)
}

// verify whether a set plan can actually be realized on the current
// slot-count and catalog/cost constraints.
export function prepSetPlanFsb(
    qppdChs: Array<EchoInstance | null>,
): (setPlan: SetPlanEntry[]) => boolean {
  const slots = Array.isArray(qppdChs) ? qppdChs : []
  const slotCount = slots.length
  const slotsByCost = new Map<number, number>()
  for (const echo of slots) {
    const cost = getEchoCost(echo)
    if (!cost) {
      continue
    }
    slotsByCost.set(cost, (slotsByCost.get(cost) ?? 0) + 1)
  }
  const available = getSetAvail()

  return (setPlan: SetPlanEntry[]): boolean => {
    if (slotCount === 0 || setPlan.length === 0) return false
    const totalPieces = setPlan.reduce((sum, entry) => sum + Math.max(0, entry.pieces), 0)
    if (totalPieces > slotCount) return false

    for (const entry of setPlan) {
      const costMap = available.get(entry.setId)
      if (!costMap) return false

      let capacity = 0
      for (const [cost, ids] of costMap.entries()) {
        capacity += Math.min(slotsByCost.get(cost) ?? 0, ids.size)
      }
      if (capacity < entry.pieces) return false
    }
    return xpndSetPlanT(setPlan, slots) != null
  }
}

export function isSetPlanFsb(
    setPlan: SetPlanEntry[],
    qppdChs: Array<EchoInstance | null>,
): boolean {
  return prepSetPlanFsb(qppdChs)(setPlan)
}


// build a deterministic signature for only the main-stat layout of a loadout.
// this is useful for deduplication when only cost and main stats matter.
export function mkEchoMainSt(echoes: Array<EchoInstance | null>): string {
  return echoes
      .filter((echo): echo is EchoInstance => echo != null)
      .map((echo) => [
        getEchoCost(echo) ?? 0,
        echo.mainStats.primary.key,
        echo.mainStats.primary.value,
        echo.mainStats.secondary.key,
        echo.mainStats.secondary.value,
      ].join('::'))
      .sort()
      .join('||')
}
