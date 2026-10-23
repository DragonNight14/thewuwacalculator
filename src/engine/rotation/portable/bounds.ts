/*
  Author: Runor Ewhro
  description: computes conservative CPU and GPU interval bounds for pruning
               portable rotation candidates without discarding unknown cases.
*/
import { ScalarOp, type ScalarProgram } from './ir'
import type { PortableRotationProgram } from './compiler'
import { TEAM_INPUT } from './layout'

const float = new Float32Array(1), bits = new Uint32Array(float.buffer)
function adjacent(value: number, up: boolean): number {
  float[0] = value
  const rounded = float[0]!
  if (Number.isNaN(rounded)) return up ? Infinity : -Infinity
  if (rounded === Infinity) { bits[0] = 0x7f7fffff; return up ? Infinity : float[0]! }
  if (rounded === -Infinity) { bits[0] = 0xff7fffff; return up ? float[0]! : -Infinity }
  if (Math.abs(rounded) < 2 ** -126 && ((up && rounded < 0) || (!up && rounded > 0))) return 0
  if (rounded === 0) { bits[0] = up ? 1 : 0x80000001; return float[0]! }
  bits[0] = bits[0]! + ((rounded > 0) === up ? 1 : -1)
  return float[0]!
}
function intervalUpper(program: ScalarProgram, low: Float64Array, high: Float64Array, lower: Float64Array, upper: Float64Array, nan: Uint8Array): number {
  const code = program.instructions
  for (let pc = 0; pc < code.length; pc += 5) {
    const op = code[pc]!, destination = code[pc + 1]!, a = code[pc + 2]!, b = code[pc + 3]!, c = code[pc + 4]!
    if (op === ScalarOp.constant) {
      const value = program.constants[a]!, f32 = Math.fround(value)
      lower[destination] = Number.isNaN(value) ? -Infinity : Math.min(value, f32)
      upper[destination] = Number.isNaN(value) ? Infinity : Math.max(value, f32)
      nan[destination] = Number(Number.isNaN(value))
      continue
    }
    if (op === ScalarOp.input) { lower[destination] = low[a]!; upper[destination] = high[a]!; nan[destination] = 0; continue }
    const al = lower[a]!, ah = upper[a]!, bl = lower[b]!, bh = upper[b]!, cl = lower[c]!, ch = upper[c]!
    let lo = -Infinity, hi = Infinity, round = false
    let mayNaN = Boolean(nan[a] || nan[b] || nan[c])
    switch (op) {
      case ScalarOp.add: lo = al + bl; hi = ah + bh; round = true; break
      case ScalarOp.sub: lo = al - bh; hi = ah - bl; round = true; break
      case ScalarOp.mul: { const values = [al * bl, al * bh, ah * bl, ah * bh]; lo = Math.min(...values); hi = Math.max(...values); round = true; break }
      case ScalarOp.div: if (bl > 0 || bh < 0) { const values = [al / bl, al / bh, ah / bl, ah / bh]; lo = Math.min(...values); hi = Math.max(...values); round = true }; break
      case ScalarOp.min: lo = Math.min(al, bl); hi = Math.min(ah, bh); break
      case ScalarOp.max: lo = Math.max(al, bl); hi = Math.max(ah, bh); break
      case ScalarOp.abs: lo = al <= 0 && ah >= 0 ? 0 : Math.min(Math.abs(al), Math.abs(ah)); hi = Math.max(Math.abs(al), Math.abs(ah)); break
      case ScalarOp.floor: lo = Math.floor(al); hi = Math.floor(ah); break
      case ScalarOp.ceil: lo = Math.ceil(al); hi = Math.ceil(ah); break
      case ScalarOp.round: lo = Math.floor(al + .5); hi = Math.floor(ah + .5); round = true; break
      case ScalarOp.eq: case ScalarOp.ne: {
        const disjoint = !(nan[a] && nan[b]) && (ah < bl || bh < al), equal = !nan[a] && !nan[b] && al !== 0 && al === ah && bl === bh && Object.is(al, bl)
        lo = op === ScalarOp.eq ? Number(equal) : Number(disjoint)
        hi = op === ScalarOp.eq ? Number(!disjoint) : Number(!equal)
        mayNaN = false
        break
      }
      case ScalarOp.lt: lo = Number(!nan[a] && !nan[b] && ah < bl); hi = Number(al < bh); mayNaN = false; break
      case ScalarOp.le: lo = Number(!nan[a] && !nan[b] && ah <= bl); hi = Number(al <= bh); mayNaN = false; break
      case ScalarOp.finite: lo = Number(!nan[a] && Number.isFinite(al) && Number.isFinite(ah)); hi = 1; mayNaN = false; break
      case ScalarOp.nan: lo = 0; hi = nan[a]!; mayNaN = false; break
      case ScalarOp.select:
        if (!nan[a] && al === 0 && ah === 0) { lo = cl; hi = ch; mayNaN = Boolean(nan[c]) }
        else if (al > 0 || ah < 0) { lo = bl; hi = bh; mayNaN = Boolean(nan[b]) }
        else { lo = Math.min(bl, cl); hi = Math.max(bh, ch); mayNaN = Boolean(nan[b] || nan[c]) }
        break
      // transcendental implementation error is device-dependent. keeping pow
      // unbounded is preferable to assuming a tolerance and pruning a winner.
      case ScalarOp.pow: mayNaN = true; break
    }
    if (Number.isNaN(lo) || Number.isNaN(hi)) { lo = -Infinity; hi = Infinity; mayNaN = true }
    if (round && (!Number.isFinite(lo) || !Number.isFinite(hi))) mayNaN = true
    if (round) { lo = Math.min(lo, adjacent(lo, false)); hi = Math.max(hi, adjacent(hi, true)) }
    lower[destination] = lo; upper[destination] = hi
    nan[destination] = Number(mayNaN)
  }
  return nan[program.outputs[0]!] ? Infinity : upper[program.outputs[0]!]!
}

export interface TheoryBoundsPayload { stats: Float32Array; sets: Uint8Array; programs: PortableRotationProgram[] }
export function theoryBranchBound(payload: TheoryBoundsPayload) {
  const low = new Float64Array(TEAM_INPUT.count), high = new Float64Array(TEAM_INPUT.count)
  const scratch = payload.programs.map((program) => ({ low: new Float64Array(program.scalar.registers), high: new Float64Array(program.scalar.registers), nan: new Uint8Array(program.scalar.registers) }))
  // per-slot ranges are reused across mains and prefixes in the same plan.
  const ranges = new WeakMap<readonly number[], { low: Float64Array; high: Float64Array; sets: Set<number>; symbols: Array<readonly [number, number]> }>()
  const range = (rows: readonly number[]) => {
    let result = ranges.get(rows)
    if (result) return result
    const low = new Float64Array(20).fill(Infinity), high = new Float64Array(20).fill(-Infinity), sets = new Set<number>()
    const symbols = payload.programs.map(() => [Infinity, -Infinity] as [number, number])
    for (const row of rows) {
      sets.add(payload.sets[row]!)
      for (let stat = 0; stat < 20; stat++) { const value = payload.stats[row * 20 + stat]!; low[stat] = Math.min(low[stat]!, value); high[stat] = Math.max(high[stat]!, value) }
      payload.programs.forEach((program, index) => { const value = program.echoSymbols[row]!; symbols[index]![0] = Math.min(symbols[index]![0], value); symbols[index]![1] = Math.max(symbols[index]![1], value) })
    }
    result = { low, high, sets, symbols }; ranges.set(rows, result); return result
  }
  return (main: number, first: number, remaining: readonly (readonly number[])[], cutoff: number): boolean => {
    if (!(cutoff > 0) || !remaining.every((rows) => rows.length)) return false
    low.fill(0); high.fill(0)
    low[TEAM_INPUT.selfMainEchoEffects] = high[TEAM_INPUT.selfMainEchoEffects] = 1
    const fixed = [main, first], rest = remaining.map(range)
    for (let slot = 0; slot < 5; slot++) {
      const row = fixed[slot], limits = rest[slot - 2]
      for (let stat = 0; stat < 20; stat++) {
        low[slot * 20 + stat] = row === undefined ? limits!.low[stat]! : payload.stats[row * 20 + stat]!
        high[slot * 20 + stat] = row === undefined ? limits!.high[stat]! : payload.stats[row * 20 + stat]!
        low[TEAM_INPUT.totals + stat] = adjacent(low[TEAM_INPUT.totals + stat]! + low[slot * 20 + stat]!, false)
        high[TEAM_INPUT.totals + stat] = adjacent(high[TEAM_INPUT.totals + stat]! + high[slot * 20 + stat]!, true)
      }
      const sets = row === undefined ? limits!.sets : new Set([payload.sets[row]!])
      low[TEAM_INPUT.echoSets + slot] = Math.min(...sets); high[TEAM_INPUT.echoSets + slot] = Math.max(...sets)
      for (const set of sets) high[TEAM_INPUT.setCounts + set]!++
      if (sets.size === 1) low[TEAM_INPUT.setCounts + sets.values().next().value!]!++
      low[TEAM_INPUT.presence + slot] = high[TEAM_INPUT.presence + slot] = 1
    }
    // theory rows use distinct profile slots as kinds; count every piece.
    for (let weapon = 0; weapon < payload.programs.length; weapon++) {
      const program = payload.programs[weapon]!
      for (let slot = 0; slot < 5; slot++) {
        const row = fixed[slot], limits = rest[slot - 2]?.symbols[weapon]
        low[TEAM_INPUT.echoIds + slot] = row === undefined ? limits![0] : program.echoSymbols[row]!
        high[TEAM_INPUT.echoIds + slot] = row === undefined ? limits![1] : program.echoSymbols[row]!
      }
      low[TEAM_INPUT.mainId] = high[TEAM_INPUT.mainId] = program.echoSymbols[main]!
      const upper = intervalUpper(program.scalar, low, high, scratch[weapon]!.low, scratch[weapon]!.high, scratch[weapon]!.nan)
      if (!Number.isFinite(upper) || upper >= cutoff) return false
    }
    return true
  }
}
