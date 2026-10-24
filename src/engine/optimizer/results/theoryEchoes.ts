/*
  Author: Runor Ewhro
  description: validates compact theory rows and materializes their catalog,
               set, main-stat, and slot-locked substat choices as echoes.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats.ts'
import type { CompactTheoryResult, OptBagResult, OptRawResult, PrepTheoryRot, PrepTheoryTarget, TheoryResultRow } from '@/engine/optimizer/types.ts'
import { fillOptBagRs } from './collector.ts'

type ThryPay = PrepTheoryTarget | PrepTheoryRot

export function matThryEcho(
    payload: ThryPay,
    result: TheoryResultRow,
): EchoInstance[] | null {
  const size = payload.profs.length
  if (
      result.ids.length !== size ||
      result.sets.length !== size ||
      result.mains.length !== size ||
      result.main < 0 ||
      result.main >= size
  ) {
    return null
  }

  if (new Set(result.ids).size !== result.ids.length) {
    return null
  }

  const catById = new Map(payload.cats.map((cat) => [cat.id, cat] as const))
  const echoes: EchoInstance[] = []

  for (let index = 0; index < size; index += 1) {
    const id = result.ids[index]
    const cat = catById.get(id)
    const setId = result.sets[index]
    const mainKey = result.mains[index]
    const prof = payload.profs[index]
    if (!id || !cat || !prof || setId == null || !mainKey || !cat.sets.includes(setId)) {
      return null
    }

    const primaryValue = ECHO_MAIN_STATS[cat.cost]?.[mainKey]
    const secondary = ECHO_SIDE_STATS[cat.cost]
    if (primaryValue == null || !secondary) {
      return null
    }

    echoes.push({
      uid: `theory:${prof.uid}:${id}:${setId}:${mainKey}:${index}`,
      id,
      set: setId,
      mainEcho: index === result.main,
      mainStats: {
        primary: {
          key: mainKey,
          value: primaryValue,
        },
        secondary: {
          key: secondary.key,
          value: secondary.value,
        },
      },
      substats: { ...prof.substats },
    })
  }

  return echoes
}


function matThryBagEcho(
    payload: ThryPay,
    result: OptBagResult,
): EchoInstance[] | null {
  const rowIds = fillOptBagRs(new Int32Array(5), result)
  const out: EchoInstance[] = new Array(payload.profs.length)
  const used = new Set<string>()
  const mainSlot = payload.theoryRows[result.i0]?.slot ?? -1

  for (let index = 0; index < rowIds.length; index += 1) {
    const row = payload.theoryRows[rowIds[index] ?? -1]
    if (!row) {
      return null
    }

    let id = row.id
    if (!id) {
      for (const candId of row.ids) {
        if (!used.has(candId)) {
          id = candId
          break
        }
      }
    }

    const prof = payload.profs[row.slot]
    const primaryValue = ECHO_MAIN_STATS[row.cost]?.[row.main]
    const secondary = ECHO_SIDE_STATS[row.cost]
    if (!id || !prof || primaryValue == null || !secondary || used.has(id)) {
      return null
    }

    used.add(id)
    out[row.slot] = {
      uid: `theory:${prof.uid}:${id}:${row.set}:${row.main}:${row.slot}`,
      id,
      set: row.set,
      mainEcho: row.slot === mainSlot,
      mainStats: {
        primary: {
          key: row.main,
          value: primaryValue,
        },
        secondary: {
          key: secondary.key,
          value: secondary.value,
        },
      },
      substats: { ...prof.substats },
    }
  }

  return out.every(Boolean) ? out : null
}

export function matThryRsltCh(
    payload: ThryPay,
    result: OptRawResult,
): EchoInstance[] | null {
  return 'ids' in result
      ? matThryEcho(payload, result)
      : matThryBagEcho(payload, result)
}

export function compactTheoryEchoes(result: CompactTheoryResult): EchoInstance[] {
  return result.indices.map((index, slot) => {
    const echo = result.theory.candidates[index]!
    return { ...echo, mainEcho: slot === result.mainSlot,
      mainStats: { primary: { ...echo.mainStats.primary }, secondary: { ...echo.mainStats.secondary } },
      substats: { ...echo.substats } }
  })
}

/** resolves identity/legality without allocating a loadout per retained result. */
export function theoryResultCompactor(payload: ThryPay) {
  const theory: CompactTheoryResult['theory'] = { candidates: [] }
  const byUid = new Map<string, number>()
  const catById = new Map(payload.cats.map((cat) => [cat.id, cat]))
  return (result: OptRawResult): Omit<CompactTheoryResult, 'stats' | 'weaponId'> | null => {
    if ('ids' in result && (result.ids.length !== payload.profs.length || result.sets.length !== payload.profs.length || result.mains.length !== payload.profs.length)) return null
    const rawIds = 'ids' in result ? null : fillOptBagRs(new Int32Array(5), result)
    const mainSlot = 'ids' in result ? result.main : payload.theoryRows[result.i0]?.slot ?? -1
    if (mainSlot < 0 || mainSlot >= payload.profs.length) return null
    const indices = new Array<number>(payload.profs.length).fill(-1)
    const used = new Set<string>()
    for (let index = 0; index < payload.profs.length; index++) {
      const row = rawIds ? payload.theoryRows[rawIds[index]!] : null
      const slot = row?.slot ?? index
      const id = row ? row.id || row.ids.find((id) => !used.has(id)) : 'ids' in result ? result.ids[index] : undefined
      const set = row?.set ?? ('sets' in result ? result.sets[index] : undefined)
      const main = row?.main ?? ('mains' in result ? result.mains[index] : undefined)
      const cat = id ? catById.get(id) : undefined
      const cost = row?.cost ?? cat?.cost
      const prof = payload.profs[slot]
      if (!id || used.has(id) || !prof || set == null || !main || cost == null || (rawIds && !row)) return null
      if (!rawIds && (!cat || !cat.sets.includes(set))) return null
      const primary = ECHO_MAIN_STATS[cost]?.[main]
      const secondary = ECHO_SIDE_STATS[cost]
      if (primary == null || !secondary || indices[slot] !== -1) return null
      used.add(id)
      const uid = `theory:${prof.uid}:${id}:${set}:${main}:${slot}`
      let candidate = byUid.get(uid)
      if (candidate == null) {
        candidate = theory.candidates.length
        byUid.set(uid, candidate)
        theory.candidates.push({ uid, id, set, mainEcho: false,
          mainStats: { primary: { key: main, value: primary }, secondary: { ...secondary } },
          substats: { ...prof.substats } })
      }
      indices[slot] = candidate
    }
    return indices.some((index) => index < 0) ? null : { theory, indices, mainSlot, damage: result.damage }
  }
}

// theory rows use the slot as kind ID, preventing two rows
// resolving to one echo. merge results through this before ranking: an
// illegal build would take a top-k slot, drop out at compaction and leave the
// list short, and its damage would raise the producer's pruning cutoff.
export function theoryResultLegality(payload: ThryPay): (result: OptRawResult) => boolean {
  const compact = theoryResultCompactor(payload)
  return (result) => compact(result) != null
}
