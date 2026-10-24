/*
  Author: Runor Ewhro
  description: compiles theoretical optimizer payloads by keeping equipped
               substat profiles fixed while preparing catalog echo metadata
               and normal optimizer target or rotation contexts.
*/

import { ECHO_STAT, MAIN_BUFF } from '@/engine/search/layout/echoLayout'
import { optimizerFloats } from '@/engine/search/layout/buffers'
import { ScalarOp, scalarSpecializer } from '@/engine/rotation/portable/ir'
import type { PortableRotationProgram } from '@/engine/rotation/portable/compiler'
import { TEAM_INPUT } from '@/engine/rotation/portable/layout'
import { listEchoes } from '@/data/catalog/echoCatalogService.ts'
import { getGameData } from '@/data/gameData'
import {
  ECHO_MAIN_STATS,
  ECHO_SIDE_STATS,
} from '@/data/gameData/catalog/echoStats.ts'
import { listEffects } from '@/data/gameData/registry.ts'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import type {
  OptStartPay,
  PrepTheoryRot,
  PrepTheoryTarget,
  ThryEchoCt,
  ThryProf,
  TheoryRow,
} from '@/engine/optimizer/types.ts'
import { compTgtRun } from '@/engine/optimizer/compiler/target.ts'
import { compRotRun } from '@/engine/optimizer/compiler/rotation.ts'
import { countTheory } from '@/engine/optimizer/search/counting.ts'
import { buildWeaponOverlays } from '@/engine/optimizer/context/weaponOverlays.ts'
import { cntThryEmt, buildSlotReps } from '@/engine/optimizer/target/theoryBatches.ts'
import { optSetIdSet } from '@/engine/optimizer/config/allowedSets.ts'
import {
  encEchoRows,
  mkMainEchoRo,
} from '@/engine/search/encode/echoes.ts'
import { ARCH_DAMAGE, ECHO_STAT_STRIDE, MAIN_BUFF_LEN } from '@/engine/search/layout/constants.ts'

const ELEMBNSKEYS = new Set(['aero', 'glacio', 'fusion', 'spectro', 'havoc', 'electro'])

function fltrKey(key: string): string | null {
  if (key === 'atkPercent') return 'atk%'
  if (key === 'hpPercent') return 'hp%'
  if (key === 'defPercent') return 'def%'
  if (key === 'energyRegen') return 'er'
  if (key === 'critRate') return 'cr'
  if (key === 'critDmg') return 'cd'
  if (key === 'healingBonus') return 'healing'
  if (ELEMBNSKEYS.has(key)) return 'bonus'
  return null
}

function mainOpts(input: OptStartPay, cost: number): string[] {
  const all = Object.keys(ECHO_MAIN_STATS[cost] ?? {})
  const filters = input.settings.mainStatFilter
  if (all.length === 0 || filters.length === 0) {
    return all
  }

  const filterSet = new Set(filters)
  const picked = all.filter((key) => {
    const bucket = fltrKey(key)
    if (!bucket || !filterSet.has(bucket)) {
      return false
    }
    return bucket !== 'bonus' || !input.settings.selectedBonus || key === input.settings.selectedBonus
  })

  return picked.length > 0 ? picked : all
}

// an echo qualifies as "self-buff" and can serve as the main echo in
// theory search when at least one of its registered effects targets self
// (either via explicit `targetScope: 'self'` or the implicit default).
function hasSelfBff(echoId: string): boolean {
  const registry = getGameData()
  const effects = listEffects(registry, { type: 'echo', id: echoId })
  for (const effect of effects) {
    const scope = effect.targetScope ?? 'self'
    if (scope === 'self') {
      return true
    }
  }
  return false
}

// collect the fixed substat profiles from the current equipped build
// theory search can change catalog identity, set, cost, and main stat later.
function mkThryProfs(input: OptStartPay): ThryProf[] {
  return input.runtime.build.echoes
      .filter((echo) => echo != null)
      .map((echo) => ({
        uid: echo.uid,
        substats: { ...echo.substats },
      }))
}

// collect catalog echo rows that can participate in theoretical set plans
// apply allowed-set filtering here for a shared generator search space.
function mkThryCats(input: OptStartPay): ThryEchoCt[] {
  const setIds = optSetIdSet(input.settings.allowedSets)

  return listEchoes()
      .filter((echo) => (
        setIds.size === 0 || echo.sets.some((setId) => setIds.has(setId))
      ))
      .map((echo) => ({
        id: echo.id,
        cost: echo.cost,
        sets: setIds.size === 0
            ? [...echo.sets]
            : echo.sets.filter((setId) => setIds.has(setId)),
        hasSelfBff: hasSelfBff(echo.id),
      }))
}

// expose locked-main catalog candidates in the shared payload slot
// the real generator will use catalog ids, but this keeps logging/routing meaningful now.
function mkMainCand(input: OptStartPay, cats: ThryEchoCt[]): Int32Array {
  const locked = input.settings.lockedMainEchoId
  const out: number[] = []

  for (let index = 0; index < cats.length; index += 1) {
    if (!locked || cats[index]?.id === locked) {
      out.push(index)
    }
  }

  return Int32Array.from(out)
}

function firstCatByKey(cats: ThryEchoCt[]): Map<string, ThryEchoCt> {
  const out = new Map<string, ThryEchoCt>()
  for (const cat of cats) {
    for (const setId of cat.sets) {
      const key = `${cat.cost}|${setId}`
      if (!out.has(key)) {
        out.set(key, cat)
      }
    }
  }
  return out
}

function idsByKey(cats: ThryEchoCt[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const cat of cats) {
    for (const setId of cat.sets) {
      const key = `${cat.cost}|${setId}`
      const list = out.get(key) ?? []
      list.push(cat.id)
      out.set(key, list)
    }
  }
  return out
}

function mkThryRows(
    input: OptStartPay,
    cats: ThryEchoCt[],
): {
  echoes: EchoInstance[]
  rows: TheoryRow[]
} {
  const echoes: EchoInstance[] = []
  const rows: TheoryRow[] = []
  const catByKey = firstCatByKey(cats)
  const idsByShape = idsByKey(cats)
  const locked = input.settings.lockedMainEchoId

  function pushRow(options: {
    slot: number
    cat: ThryEchoCt
    ids: string[]
    id: string | null
    setId: number
    main: string
    mainOk: boolean
  }): void {
    const secondary = ECHO_SIDE_STATS[options.cat.cost]
    const primaryValue = ECHO_MAIN_STATS[options.cat.cost]?.[options.main]
    const prof = input.runtime.build.echoes[options.slot]
    if (!secondary || primaryValue == null || !prof) {
      return
    }

    rows.push({
      slot: options.slot,
      id: options.id,
      ids: options.ids,
      set: options.setId,
      main: options.main,
      cost: options.cat.cost,
      mainOk: options.mainOk,
    })

    echoes.push({
      uid: `theory-row:${options.slot}:${rows.length - 1}`,
      id: options.id ?? options.cat.id,
      set: options.setId,
      mainEcho: false,
      mainStats: {
        primary: {
          key: options.main,
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

  for (let slot = 0; slot < input.runtime.build.echoes.length; slot += 1) {
    if (!input.runtime.build.echoes[slot]) {
      continue
    }

    const fillers = input.settings.rotationMode
      ? cats.flatMap((cat) => cat.sets.map((set) => [`${cat.cost}|${set}`, cat] as const))
      : [...catByKey.entries()]
    for (const [key, cat] of fillers) {
      const [, setPart] = key.split('|')
      const setId = Number(setPart)
      const ids = input.settings.rotationMode ? [cat.id] : idsByShape.get(key) ?? []
      for (const main of mainOpts(input, cat.cost)) {
        pushRow({
          slot,
          cat,
          ids,
          id: input.settings.rotationMode ? cat.id : null,
          setId,
          main,
          mainOk: false,
        })
      }
    }

    for (const cat of cats) {
      const canMain = locked ? cat.id === locked : input.settings.rotationMode || cat.hasSelfBff
      if (!canMain) {
        continue
      }

      for (const setId of cat.sets) {
        for (const main of mainOpts(input, cat.cost)) {
          pushRow({
            slot,
            cat,
            ids: [cat.id],
            id: cat.id,
            setId,
            main,
            mainOk: true,
          })
        }
      }
    }
  }

  return { echoes, rows }
}

function allMask(size: number): boolean[] {
  return Array.from({ length: size }, () => true)
}

function emptyMask(size: number): boolean[] {
  return Array.from({ length: size }, () => false)
}

function hasActCstr(values: Float32Array): boolean {
  for (let index = 0; index < values.length; index += 2) {
    if ((values[index] ?? 1) <= (values[index + 1] ?? 0)) {
      return true
    }
  }
  return false
}

function elemStatIdx(element: string): number | null {
  switch (element) {
    case 'aero': return ECHO_STAT.aero
    case 'glacio': return ECHO_STAT.glacio
    case 'fusion': return ECHO_STAT.fusion
    case 'spectro': return ECHO_STAT.spectro
    case 'havoc': return ECHO_STAT.havoc
    case 'electro': return ECHO_STAT.electro
    default: return null
  }
}

function elemMainIdx(element: string): number | null {
  switch (element) {
    case 'aero': return MAIN_BUFF.aero
    case 'glacio': return MAIN_BUFF.glacio
    case 'fusion': return MAIN_BUFF.fusion
    case 'spectro': return MAIN_BUFF.spectro
    case 'havoc': return MAIN_BUFF.havoc
    case 'electro': return MAIN_BUFF.electro
    default: return null
  }
}

function addSkllMasks(
    statMask: boolean[],
    mainMask: boolean[],
    skillTypes: readonly string[],
): void {
  const all = skillTypes.includes('all')
  if (all || skillTypes.includes('basicAtk')) {
    statMask[ECHO_STAT.basicAtk] = true
    mainMask[MAIN_BUFF.basicAtk] = true
  }
  if (all || skillTypes.includes('heavyAtk')) {
    statMask[ECHO_STAT.heavyAtk] = true
    mainMask[MAIN_BUFF.heavyAtk] = true
  }
  if (all || skillTypes.includes('resonanceSkill')) {
    statMask[ECHO_STAT.resonanceSkill] = true
    mainMask[MAIN_BUFF.resonanceSkill] = true
  }
  if (all || skillTypes.includes('resonanceLiberation')) {
    statMask[ECHO_STAT.resonanceLiberation] = true
    mainMask[MAIN_BUFF.resonanceLiberation] = true
  }
  if (all || skillTypes.includes('echoSkill')) {
    mainMask[MAIN_BUFF.echoSkill] = true
  }
  if (all || skillTypes.includes('coord')) {
    mainMask[MAIN_BUFF.coord] = true
  }
}

function addSkllBits(
    statMask: boolean[],
    mainMask: boolean[],
    skillMask: number,
): void {
  if ((skillMask & (1 << 0)) !== 0) {
    statMask[ECHO_STAT.basicAtk] = true
    mainMask[MAIN_BUFF.basicAtk] = true
  }
  if ((skillMask & (1 << 1)) !== 0) {
    statMask[ECHO_STAT.heavyAtk] = true
    mainMask[MAIN_BUFF.heavyAtk] = true
  }
  if ((skillMask & (1 << 2)) !== 0) {
    statMask[ECHO_STAT.resonanceSkill] = true
    mainMask[MAIN_BUFF.resonanceSkill] = true
  }
  if ((skillMask & (1 << 3)) !== 0) {
    statMask[ECHO_STAT.resonanceLiberation] = true
    mainMask[MAIN_BUFF.resonanceLiberation] = true
  }
  if ((skillMask & (1 << 6)) !== 0) {
    mainMask[MAIN_BUFF.echoSkill] = true
  }
  if ((skillMask & (1 << 7)) !== 0) {
    mainMask[MAIN_BUFF.coord] = true
  }
}

function addElemBits(
    statMask: boolean[],
    mainMask: boolean[],
    elemIndex: number,
): void {
  const statByElem = [
    ECHO_STAT.aero,
    ECHO_STAT.glacio,
    ECHO_STAT.fusion,
    ECHO_STAT.spectro,
    ECHO_STAT.havoc,
    ECHO_STAT.electro,
  ]
  const mainByElem = [
    MAIN_BUFF.aero,
    MAIN_BUFF.glacio,
    MAIN_BUFF.fusion,
    MAIN_BUFF.spectro,
    MAIN_BUFF.havoc,
    MAIN_BUFF.electro,
  ]
  const statIndex = statByElem[elemIndex]
  const mainIndex = mainByElem[elemIndex]
  if (statIndex != null) statMask[statIndex] = true
  if (mainIndex != null) mainMask[mainIndex] = true
}

function addNormalCtxMs(
    statMask: boolean[],
    mainMask: boolean[],
    options: {
      scalingAtk: number
      scalingHp: number
      scalingDef: number
      scalingEr: number
      characterId?: number
      skillMask: number
      elemIndex: number
    },
): void {
  if (options.scalingAtk !== 0) {
    statMask[ECHO_STAT.atkPercent] = true
    statMask[ECHO_STAT.atkFlat] = true
    mainMask[MAIN_BUFF.atkPercent] = true
    mainMask[MAIN_BUFF.atkFlat] = true
  }
  if (options.scalingHp !== 0) {
    statMask[ECHO_STAT.hpPercent] = true
    statMask[ECHO_STAT.hpFlat] = true
  }
  if (options.scalingDef !== 0) {
    statMask[ECHO_STAT.defPercent] = true
    statMask[ECHO_STAT.defFlat] = true
  }
  if (
      options.scalingEr !== 0 ||
      (options.characterId != null && [1206, 1209, 1412, 1505, 1512].includes(options.characterId))
  ) {
    statMask[ECHO_STAT.energyRegen] = true
    mainMask[MAIN_BUFF.energyRegen] = true
  }

  statMask[ECHO_STAT.critRate] = true
  statMask[ECHO_STAT.critDmg] = true
  // include main-echo crit and damage bonuses in the dedupe key.
  mainMask[MAIN_BUFF.critRate] = true
  mainMask[MAIN_BUFF.critDmg] = true
  mainMask[MAIN_BUFF.dmgBonus] = true
  if (options.skillMask !== 0) {
    addSkllBits(statMask, mainMask, options.skillMask)
  }
  if (options.elemIndex >= 0) {
    addElemBits(statMask, mainMask, options.elemIndex)
  }
}

// contribution masks exclude fields unused by the selected calculation.
function mkCntrMasks(payload: PrepTheoryTarget | PrepTheoryRot): {
  statMask: boolean[]
  mainMask: boolean[]
} {
  if (hasActCstr(payload.constraints)) {
    return {
      statMask: allMask(ECHO_STAT_STRIDE),
      mainMask: allMask(MAIN_BUFF_LEN),
    }
  }

  const statMask = emptyMask(ECHO_STAT_STRIDE)
  const mainMask = emptyMask(MAIN_BUFF_LEN)

  if (payload.mode === 'theoryRotation') {
    const programs = payload.weaponPrograms?.length ? payload.weaponPrograms : [payload.rotationProgram]
    for (const program of programs) for (let pc = 0; pc < program.scalar.instructions.length; pc += 5) {
      if (program.scalar.instructions[pc] !== ScalarOp.input) continue
      const input = program.scalar.instructions[pc + 2]!
      if (input < TEAM_INPUT.setCounts) statMask[input % ECHO_STAT_STRIDE] = true
      if (input >= TEAM_INPUT.totals && input < TEAM_INPUT.totals + ECHO_STAT_STRIDE) statMask[input - TEAM_INPUT.totals] = true
    }
    return { statMask, mainMask }
  }

  const cmp = payload.compiled

  if (cmp.archetype !== ARCH_DAMAGE || cmp.fixedDmg > 0) {
    return { statMask, mainMask }
  }

  addNormalCtxMs(statMask, mainMask, {
    scalingAtk: cmp.scalingAtk,
    scalingHp: cmp.scalingHp,
    scalingDef: cmp.scalingDef,
    scalingEr: cmp.scalingER,
    characterId: cmp.characterId,
    skillMask: 0,
    elemIndex: -1,
  })
  addSkllMasks(statMask, mainMask, payload.selectedSkill.skillType)

  const stElem = elemStatIdx(payload.selectedSkill.element)
  const mnElem = elemMainIdx(payload.selectedSkill.element)
  if (stElem != null) statMask[stElem] = true
  if (mnElem != null) mainMask[mnElem] = true

  return { statMask, mainMask }
}

function sigRow(
    values: Float32Array,
    base: number,
    mask: readonly boolean[],
): string {
  const parts: string[] = []
  for (let offset = 0; offset < mask.length; offset += 1) {
    if (mask[offset]) {
      parts.push(String(Math.round((values[base + offset] ?? 0) * 100_000)))
    }
  }
  return parts.join(',')
}

function mergeIds(left: TheoryRow, right: TheoryRow): void {
  const ids = new Set(left.ids)
  for (const id of right.ids) {
    ids.add(id)
  }
  left.ids = [...ids]

  if (left.id !== right.id) {
    left.id = ids.size === 1 ? (left.ids[0] ?? null) : null
  }
}

// collapse rows that are identical for the active calculation before search.
// this keeps irrelevant main stats and equivalent main-echo effects from
// becoming real cpu combinations.
function prnThryRows<T extends PrepTheoryTarget | PrepTheoryRot>(
    payload: T,
    rows: TheoryRow[],
    encoded: ReturnType<typeof encEchoRows>,
    mainEchoBuffs: Float32Array,
): T {
  const { statMask, mainMask } = mkCntrMasks(payload)
  const programs = payload.mode === 'theoryRotation' ? payload.weaponPrograms?.length ? payload.weaponPrograms : [payload.rotationProgram] : []
  const usedInputs = new Set<number>()
  for (const program of programs) for (let pc = 0; pc < program.scalar.instructions.length; pc += 5) if (program.scalar.instructions[pc] === ScalarOp.input) usedInputs.add(program.scalar.instructions[pc + 2]!)
  const mainIdentity = usedInputs.has(149)
  const echoIdentity = [...usedInputs].some((index) => index >= 139 && index < 144)
  const identityKeys = portableIdentityKeys(programs, mainIdentity, echoIdentity)
  const rowMap = new Map<string, number>()
  const outRows: TheoryRow[] = []
  const sourceRows: number[] = []
  const keepSet = programs.length ? [...usedInputs].some((index) => (index >= 100 && index < 139) || (index >= 144 && index < 149)) : statMask.some(Boolean) || mainMask.some(Boolean)

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row) {
      continue
    }

    const statSig = sigRow(encoded.stats, index * ECHO_STAT_STRIDE, statMask)
    const mainSig = row.mainOk
        ? sigRow(mainEchoBuffs, index * MAIN_BUFF_LEN, mainMask)
        : ''
    const key = [
      row.slot,
      keepSet ? row.set : '*',
      row.mainOk ? 1 : 0,
      statSig,
      mainSig,
      programs.length ? identityKeys(row.mainOk, index) : '',
    ].join('|')
    const seen = rowMap.get(key)

    if (seen != null) {
      const prev = outRows[seen]!
      if (row.cost !== prev.cost) {
        if (row.cost < prev.cost) {
          outRows[seen] = { ...row, ids: [...row.ids] }
          sourceRows[seen] = index
        }
        continue
      }

      if (!keepSet && row.set !== prev.set) {
        if (row.ids.length > prev.ids.length) {
          outRows[seen] = { ...row, ids: [...row.ids] }
          sourceRows[seen] = index
        }
        continue
      }

      mergeIds(prev, row)
      continue
    }

    rowMap.set(key, outRows.length)
    outRows.push({ ...row, ids: [...row.ids] })
    const dst = outRows.length - 1
    sourceRows[dst] = index
  }

  // allocate only the surviving numeric rows, directly in final storage.
  const costs = new Uint8Array(outRows.length)
  const sets = new Uint8Array(outRows.length)
  const stats = optimizerFloats(outRows.length * ECHO_STAT_STRIDE)
  const mains = optimizerFloats(outRows.length * MAIN_BUFF_LEN)
  for (let dst = 0; dst < sourceRows.length; dst++) {
    const src = sourceRows[dst]!
    costs[dst] = encoded.costs[src] ?? 0
    sets[dst] = encoded.sets[src] ?? 0
    stats.set(encoded.stats.subarray(src * ECHO_STAT_STRIDE, (src + 1) * ECHO_STAT_STRIDE), dst * ECHO_STAT_STRIDE)
    mains.set(mainEchoBuffs.subarray(src * MAIN_BUFF_LEN, (src + 1) * MAIN_BUFF_LEN), dst * MAIN_BUFF_LEN)
  }

  const kinds = new Uint16Array(outRows.length)
  for (let index = 0; index < outRows.length; index += 1) {
    kinds[index] = outRows[index]?.slot ?? 0
  }

  // count the same combinations emitted by gnrtThryCpuCm without allocating
  // each combo; use matching slot representatives for an exact progress total.
  const slotReps = payload.profs ? buildSlotReps(payload.profs) : null
  const exactTtl = cntThryEmt(outRows, slotReps)

  return {
    ...payload,
    ...(payload.mode === 'theoryRotation' ? {
      rotationProgram: remapPortableRows(payload.rotationProgram, sourceRows),
      weaponPrograms: payload.weaponPrograms?.map((program) => remapPortableRows(program, sourceRows)),
    } : {}),
    ...(payload.mode === 'theoryRotation' && payload.candidateEchoes
      ? { candidateEchoes: sourceRows.map((index) => payload.candidateEchoes![index]!) }
      : {}),
    costs,
    sets,
    kinds,
    comboN: outRows.length,
    totalCombos: exactTtl,
    lockMainCands: Int32Array.from(outRows
        .map((row, index) => row.mainOk ? index : -1)
        .filter((index) => index >= 0)),
    stats,
    mainEchoBuffs: mains,
    theoryTotal: exactTtl,
    theoryRows: outRows,
  }
}

function remapPortableRows(program: PortableRotationProgram, rows: number[]): PortableRotationProgram {
  return { ...program, echoSymbols: Uint32Array.from(rows, (row) => program.echoSymbols[row]!) }
}

/** main and filler identities are merged only after partial evaluation proves
 * they have the same full-program behavior, including the sheet stats. */
function portableIdentityKeys(programs: PortableRotationProgram[], mainIdentity: boolean, echoIdentity: boolean) {
  const specialize = programs.map((program) => scalarSpecializer(program.displayScalar))
  const cache = programs.map(() => new Map<string, string>())
  return (main: boolean, row: number): string => {
    if (main ? !mainIdentity && !echoIdentity : !echoIdentity) return ''
    return programs.map((program, index) => {
      const symbol = program.echoSymbols[row]!, key = `${main ? 'm' : 'f'}:${symbol}`
      const known = cache[index]!.get(key)
      if (known !== undefined) return known
      const presence = new Map<number, number>(Array.from({ length: 5 }, (_, slot) => [151 + slot, 1]))
      const results: string[] = []
      if (main) {
        presence.set(149, symbol); presence.set(139, symbol)
        results.push(specialize[index]!(presence))
      } else for (let slot = 1; slot < 5; slot++) {
        const bindings = new Map(presence); bindings.set(139 + slot, symbol)
        results.push(specialize[index]!(bindings))
      }
      const signature = results.join(';')
      cache[index]!.set(key, signature)
      return signature
    }).join('|')
  }
}

function applyTheoryRows<T extends PrepTheoryTarget | PrepTheoryRot>(
    payload: T,
    input: OptStartPay,
    echoes: EchoInstance[],
    rows: TheoryRow[],
): T {
  const skll = payload.mode === 'theoryTarget'
      ? payload.selectedSkill
      : {
        id: 'theory:rotation',
        label: 'Rotation',
        tab: 'rotation',
        element: 'physical' as const,
        skillType: [],
        archetype: 'skillDamage' as const,
      }
  const encoded = encEchoRows(echoes, skll, 'self')
  const mainEchoBuffs = payload.mode === 'theoryTarget'
      ? mkMainEchoRo({
        echoes,
        runtime: input.runtime,
        sourceBaseStats: payload.sourceBaseStats,
        sourceFinals: payload.sourceFinals,
        selectedSkill: payload.selectedSkill,
      })
      : new Float32Array(rows.length * MAIN_BUFF_LEN)

  // use profile slots as kind ids for legal five-echo set counts.
  const kinds = new Uint16Array(rows.length)
  for (let index = 0; index < rows.length; index += 1) {
    kinds[index] = rows[index]?.slot ?? 0
  }
  const thryTotal = countTheory(input.settings, input.runtime)
  const nextPayload = {
    ...payload,
    costs: encoded.costs,
    sets: encoded.sets,
    kinds,
    comboN: rows.length,
    totalCombos: thryTotal,
    lockMainReq: true,
    lockMainCands: Int32Array.from(rows
        .map((row, index) => row.mainOk ? index : -1)
        .filter((index) => index >= 0)),
    progFact: 1,
    stats: encoded.stats,
    mainEchoBuffs,
    ...(payload.mode === 'theoryRotation' ? { candidateEchoes: echoes } : {}),
    theoryTotal: thryTotal,
    theoryRows: rows,
  }

  return prnThryRows(nextPayload, rows, encoded, mainEchoBuffs)
}

// compile single-target theory payloads by reusing the normal target context compiler
// with an empty bag, then attaching theory-specific catalog/profile inputs.
export function compThryTgt(input: OptStartPay): PrepTheoryTarget {
  const profs = mkThryProfs(input)
  const cats = mkThryCats(input)
  const theory = mkThryRows(input, cats)
  const base = compTgtRun({
    ...input,
    invChs: [],
  })

  // score each build with every visible weapon and record the best result.
  // weapon options leave the echo combination space unchanged.
  const weapons = input.settings.includeWeapons
      ? buildWeaponOverlays(input)
      : null

  const payload: PrepTheoryTarget = {
    ...base,
    mode: 'theoryTarget',
    staticData: input.staticData,
    theoryTotal: countTheory(input.settings, input.runtime),
    lockMainCands: mkMainCand(input, cats),
    profs,
    cats,
    mainFltr: [...input.settings.mainStatFilter],
    selBonus: input.settings.selectedBonus,
    theoryRows: [],
    weaponOverlays: weapons?.overlays,
    weaponCount: weapons?.count,
    weaponIds: weapons?.weaponIds,
  }

  return applyTheoryRows(payload, input, theory.echoes, theory.rows)
}

// compile rotation theory payloads by reusing the normal rotation context compiler
// with an empty bag, then attaching theory-specific catalog/profile inputs.
export function compThryRot(input: OptStartPay): PrepTheoryRot {
  const profs = mkThryProfs(input)
  const cats = mkThryCats(input)
  const theory = mkThryRows(input, cats)
  // weapon search is a theory-mode feature; opt the rotation compiler into
  // building per-weapon context sets when includeWeapons is on.
  const base = compRotRun(
      {
        ...input,
        invChs: [],
      },
      { weaponSearch: true, teamCandidates: theory.echoes },
  )

  const payload: PrepTheoryRot = {
    ...base,
    mode: 'theoryRotation',
    staticData: input.staticData,
    theoryTotal: countTheory(input.settings, input.runtime),
    lockMainCands: mkMainCand(input, cats),
    profs,
    cats,
    mainFltr: [...input.settings.mainStatFilter],
    selBonus: input.settings.selectedBonus,
    theoryRows: [],
  }

  return applyTheoryRows(payload, input, theory.echoes, theory.rows)
}
