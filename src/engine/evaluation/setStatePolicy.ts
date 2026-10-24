/*
  Author: Runor Ewhro
  description: compiles compact resonator set-state rules into the conditional
               format consumed by build evaluation.
*/

import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import {
  DEF_SET_COND,
  type SntSetConds,
  withSntSet,
} from '@/domain/entities/sonataSetConditionals'

type SetRule = {
  type: 'include' | 'exclude'
  sets?: readonly number[]
  states?: readonly string[]
}

type PreservedSetPlan = {
  setId: number
  pieces: number
}

export type EvaluationSetConditionOptions = {
  preservedUtilityPlan?: readonly PreservedSetPlan[]
  preservedUtilityControls?: Readonly<Record<string, boolean | number | string | undefined>>
}

export const SET_RULES: Partial<Record<string, SetRule>> = {
  '1102': { type: 'include', sets: [1, 9] }, // sanhua
  '1103': { type: 'include', sets: [1] }, // baizhi
  '1104': { type: 'include', sets: [1, 9] }, // lingyang
  '1105': { type: 'include', sets: [1, 9, 13] }, // zhezhi
  '1106': { type: 'include', sets: [1, 9] }, // youhu
  '1107': { type: 'include', sets: [1, 9, 10] }, // carlotta
  '1108': { type: 'include', sets: [1, 9, 30] }, // hiyuki
  '1109': { type: 'include', sets: [1, 9, 30, 19] }, // lucilla
  '1110': { type: 'include', sets: [1] }, // suisui
  '1202': { type: 'include', sets: [2, 9] }, // chixia
  '1203': { type: 'include', sets: [2, 9] }, // encore
  '1204': { type: 'include', sets: [2, 9, 13] }, // mortefi
  '1205': { type: 'include', sets: [2, 9] }, // changli
  '1206': { type: 'include', sets: [2, 9] }, // brant
  '1207': { type: 'include', sets: [2, 9, 18] }, // lupa
  '1208': { type: 'include', sets: [2, 9, 22] }, // galbrena
  '1209': { type: 'include', sets: [2] }, // mornye
  '1210': { type: 'include', sets: [2, 9, 27] }, // aemeath
  '1211': { type: 'include', sets: [2, 9, 27, 28] }, // denia
  '1301': { type: 'include', sets: [3, 9] }, // calcharo
  '1302': { type: 'include', sets: [3, 9, 13] }, // yinlin
  '1303': { type: 'include', sets: [3, 13] }, // yuanwu
  '1304': { type: 'include', sets: [5, 9] }, // jinhsi
  '1305': { type: 'include', sets: [3, 9] }, // xiangli yao
  '1306': { type: 'include', sets: [3, 9, 20] }, // augusta
  '1307': { type: 'include', sets: [3, 9] }, // buling
  '1308': { type: 'include', sets: [3, 9, 32] }, // rebecca
  '1309': { type: 'include', sets: [3, 9, 36] }, // rover: electro
  '1310': { type: 'include', sets: [3, 9, 36] }, // rover: electro
  '1311': { type: 'include', sets: [3, 9, 36] }, // hsin
  '1312': { type: 'include', sets: [3, 9, 36] }, // suoming
  '1402': { type: 'include', sets: [4, 9] }, // yangyang
  '1403': { type: 'include', sets: [4, 9] }, // aalto
  '1404': { type: 'include', sets: [4, 9] }, // jiyan
  '1405': { type: 'include', sets: [4, 9] }, // jianxin
  '1406': { type: 'include', sets: [4, 9, 17] }, // rover: aero
  '1407': { type: 'include', sets: [4, 17, 16] }, // ciaccona
  '1408': { type: 'include', sets: [4, 9, 17] }, // rover: aero
  '1409': { type: 'include', sets: [4, 17, 16] }, // cartethyia
  '1410': { type: 'include', sets: [4, 9, 20] }, // iuno
  '1411': { type: 'include', sets: [4, 9, 22, 29] }, // qiuyuan
  '1412': { type: 'include', sets: [4, 9, 29] }, // sigrika
  '1501': { type: 'include', sets: [5, 9, 11] }, // rover: spectro
  '1502': { type: 'include', sets: [5, 9, 11] }, // rover: spectro
  '1503': { type: 'include', sets: [5, 9] }, // verina
  '1504': { type: 'include', sets: [3, 9] }, // lumi
  '1505': { type: 'include', sets: [5] }, // shorekeeper
  '1506': { type: 'include', sets: [5, 9, 11] }, // phoebe
  '1507': { type: 'include', sets: [5, 9, 11] }, // zani
  '1508': { type: 'include', sets: [6, 9, 23] }, // chisa
  '1509': { type: 'include', sets: [5, 9, 26] }, // lynae
  '1510': { type: 'include', sets: [5, 9, 26] }, // luuk herssen
  '1511': { type: 'include', sets: [5, 9, 32] }, // lucy
  '1512': {type: 'include', sets: [5, 38] }, // lily
  '1601': { type: 'include', sets: [6] }, // taoqi
  '1602': { type: 'include', sets: [6, 9] }, // danjin
  '1603': { type: 'include', sets: [6, 9] }, // camellya
  '1604': { type: 'include', sets: [6, 9] }, // rover: havoc
  '1605': { type: 'include', sets: [6, 9] }, // rover: havoc
  '1606': { type: 'include', sets: [6, 9] }, // roccia
  '1607': { type: 'include', sets: [6, 9] }, // cantarella
  '1608': { type: 'include', sets: [6, 9, 19] }, // phrolova
  '1610': { type: 'include', sets: [6, 9, 33] }, // yangyang: xuanling
  '1212': { type: 'include', sets: [2, 9, 18, 20, 35] }, // jingran
  '1413': { type: 'include', sets: [4, 34] }, // jingran
}

type StateRef = { setId: number; key: string }
let cachedStateRefs: StateRef[] | null = null

function stateRefs(): StateRef[] {
  // flatten state keys once and reject duplicates because condition maps are
  // keyed by partKey alone in the evaluation policy output
  if (cachedStateRefs) return cachedStateRefs
  const refs: StateRef[] = []
  const seen = new Set<string>()

  for (const set of ECHO_SET_DEFS) {
    for (const key of Object.keys(set.states)) {
      if (seen.has(key)) {
        throw new Error(`Duplicate Sonata state key: ${key}`)
      }
      seen.add(key)
      refs.push({ setId: set.id, key })
    }
  }

  if (ECHO_SET_DEFS.length > 0) cachedStateRefs = refs
  return refs
}

function utilityControlKey(setId: number, stateKey: string): string {
  // utility set controls are stored under the same runtime keys used by the app,
  // so preserved utility plans can opt their active state back into evaluations
  return `echoSet:${setId}:bonus:${stateKey}`
}

function isControlActive(value: unknown): boolean {
  // controls may be toggles, stack counts, or string-backed inputs; any useful
  // non-empty value means the preserved utility state should be considered on
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  if (typeof value === 'string') return value.length > 0
  return false
}

export function evaluationSetConditions(
  resonatorId: string,
  options: EvaluationSetConditionOptions = {},
): SntSetConds {
  // include rules whitelist damage-relevant sets, exclude rules invert that
  // selection, and preserved utility plans add only controls the user had active
  const rule = SET_RULES[resonatorId]
  const refs = stateRefs()
  const byKey = new Map(refs.map((ref) => [ref.key, ref]))
  const selected = new Set<string>()

  for (const setId of rule?.sets ?? []) {
    const matches = refs.filter((ref) => ref.setId === setId)
    if (matches.length === 0) {
      throw new Error(`Unknown or stateless Sonata set in evaluation rule: ${setId}`)
    }
    for (const ref of matches) selected.add(ref.key)
  }

  for (const key of rule?.states ?? []) {
    if (!byKey.has(key)) {
      throw new Error(`Unknown Sonata state in evaluation rule: ${key}`)
    }
    selected.add(key)
  }

  for (const plan of options.preservedUtilityPlan ?? []) {
    const set = ECHO_SET_DEFS.find((def) => def.id === plan.setId)
    if (!set || set.type !== 'utility' || plan.pieces !== set.setMax) {
      continue
    }
    for (const key of Object.keys(set.states)) {
      if (isControlActive(options.preservedUtilityControls?.[utilityControlKey(set.id, key)])) {
        selected.add(key)
      }
    }
  }

  return withSntSet(DEF_SET_COND, refs
    .map((ref) => ({
      setId: ref.setId,
      partKey: ref.key,
      checked: rule?.type === 'exclude'
        ? !selected.has(ref.key)
        : selected.has(ref.key),
    })))
}
