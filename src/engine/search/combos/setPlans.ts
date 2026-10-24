/*
  Author: Runor Ewhro
  description: defines set-plan entries and enumerates the simple plans a given
               Echo slot count can support.
*/

import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'

export interface SetPlanEntry {
  setId: number
  pieces: number
}

const setPlanCache = new Map<number, SetPlanEntry[][]>()

// enumerate all simple set-plan candidates allowed by the current slot count
export function mkSetPlanCnd(slotCount: number): SetPlanEntry[][] {
  const cached = setPlanCache.get(slotCount)
  if (cached) return cached

  const fivePcSetIds = ECHO_SET_DEFS
      .filter((entry) => entry.setMax === 5)
      .map((entry) => entry.id)

  const thrPcSetIds = ECHO_SET_DEFS
      .filter((entry) => entry.setMax === 3)
      .map((entry) => entry.id)

  const onePcSetIds = ECHO_SET_DEFS
      .filter((entry) => entry.setMax === 1)
      .map((entry) => entry.id)

  const plans: SetPlanEntry[][] = []

  // standalone 1pc plans
  for (const setId of onePcSetIds) {
    if (slotCount >= 1) {
      plans.push([{ setId, pieces: 1 }])
    }
  }

  // standalone 2pc / 5pc plans
  for (const setId of fivePcSetIds) {
    if (slotCount >= 2) {
      plans.push([{ setId, pieces: 2 }])
    }
    if (slotCount >= 5) {
      plans.push([{ setId, pieces: 5 }])
    }
  }

  // standalone 3pc plans
  for (const setId of thrPcSetIds) {
    if (slotCount >= 3) {
      plans.push([{ setId, pieces: 3 }])
    }
  }

  // two different 2pc plans
  for (let left = 0; left < fivePcSetIds.length; left += 1) {
    for (let right = left + 1; right < fivePcSetIds.length; right += 1) {
      if (slotCount >= 4) {
        plans.push([
          { setId: fivePcSetIds[left], pieces: 2 },
          { setId: fivePcSetIds[right], pieces: 2 },
        ])
      }
    }
  }

  // mixed 2pc + 3pc plans
  for (const fiveSetId of fivePcSetIds) {
    for (const threeSetId of thrPcSetIds) {
      if (slotCount >= 5) {
        plans.push([
          { setId: fiveSetId, pieces: 2 },
          { setId: threeSetId, pieces: 3 },
        ])
      }
    }
  }

  // mixed 1pc + other plans
  for (const oneSetId of onePcSetIds) {
    // 1pc + 5pc (2pc/5pc)
    for (const fiveSetId of fivePcSetIds) {
      if (slotCount >= 3) {
        plans.push([
          { setId: oneSetId, pieces: 1 },
          { setId: fiveSetId, pieces: 2 },
        ])
      }
      if (slotCount >= 6) { // guard the general case beyond five slots.
        plans.push([
          { setId: oneSetId, pieces: 1 },
          { setId: fiveSetId, pieces: 5 },
        ])
      }
    }
    // 1pc + 3pc
    for (const threeSetId of thrPcSetIds) {
      if (slotCount >= 4) {
        plans.push([
          { setId: oneSetId, pieces: 1 },
          { setId: threeSetId, pieces: 3 },
        ])
      }
    }
    // 1pc + 2pc + 2pc
    for (let left = 0; left < fivePcSetIds.length; left += 1) {
      for (let right = left + 1; right < fivePcSetIds.length; right += 1) {
        if (slotCount >= 5) {
          plans.push([
            { setId: oneSetId, pieces: 1 },
            { setId: fivePcSetIds[left], pieces: 2 },
            { setId: fivePcSetIds[right], pieces: 2 },
          ])
        }
      }
    }
  }

  if (ECHO_SET_DEFS.length > 0) setPlanCache.set(slotCount, plans)
  return plans
}
