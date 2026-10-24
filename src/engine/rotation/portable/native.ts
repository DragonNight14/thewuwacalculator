/*
  Author: Runor Ewhro
  description: converts portable scalar programs into structured native or WGSL
               arithmetic with resolved registers and shared branch scopes.
*/
import { ScalarBuilder, ScalarOp, type ScalarOpcode, type ScalarProgram } from './ir'
import { TEAM_INPUT } from './layout'
import { SHADER_BRANCH_DEPTH } from '@/engine/search/layout/constants'

interface Expression { op: ScalarOpcode; a: number; b: number; c: number; value: number }
interface Graph { nodes: Expression[]; outputs: number[] }
interface Scope { parent: number; depth: number; nodes: number[] }

function graph(program: ScalarProgram): Graph {
  const nodes: Expression[] = [], registers = new Uint32Array(program.registers)
  for (let pc = 0; pc < program.instructions.length; pc += 5) {
    const [op, destination, a, b, c] = program.instructions.subarray(pc, pc + 5) as unknown as [ScalarOpcode, number, number, number, number]
    const literal = op === ScalarOp.constant || op === ScalarOp.input
    nodes.push({ op, a: literal ? a : registers[a]!, b: literal ? 0 : registers[b]!, c: literal ? 0 : registers[c]!, value: op === ScalarOp.constant ? program.constants[a]! : 0 })
    registers[destination] = nodes.length - 1
  }
  return { nodes, outputs: Array.from(program.outputs, (slot) => registers[slot]!) }
}

export function mergeScalarPrograms(programs: readonly ScalarProgram[], input: (program: number, index: number) => number): ScalarProgram {
  const ir = new ScalarBuilder(), outputs: number[] = []
  programs.forEach((program, index) => {
    const registers = new Uint32Array(program.registers), code = program.instructions
    for (let pc = 0; pc < code.length; pc += 5) {
      const op = code[pc]! as ScalarOpcode, destination = code[pc + 1]!, a = code[pc + 2]!, b = code[pc + 3]!, c = code[pc + 4]!
      registers[destination] = op === ScalarOp.constant ? ir.constant(program.constants[a]!)
        : op === ScalarOp.input ? ir.input(input(index, a)) : ir.operation(op, registers[a]!, registers[b]!, registers[c]!)
    }
    outputs.push(...Array.from(program.outputs, (slot) => registers[slot]!))
  })
  return ir.finish(outputs)
}

export function mergeRotationScalars(programs: readonly ScalarProgram[]): ScalarProgram {
  return mergeScalarPrograms(programs, (weapon, index) =>
    index >= TEAM_INPUT.echoIds && index < TEAM_INPUT.echoSets ? TEAM_INPUT.count + weapon * 6 + index - TEAM_INPUT.echoIds
      : index === TEAM_INPUT.mainId ? TEAM_INPUT.count + weapon * 6 + 5 : index)
}

export function mainInvariantInput(index: number): boolean {
  return (index >= TEAM_INPUT.setCounts && index < TEAM_INPUT.echoIds)
    || (index >= TEAM_INPUT.presence && index < TEAM_INPUT.count) || index === TEAM_INPUT.mainPosition
}

export function arithmeticSource(program: ScalarProgram, options: {
  language: 'wgsl' | 'js'
  input: (index: number) => string
  invariant?: (index: number) => boolean
  /** lexical inputs for extracted WGSL helpers, including candidate arrays. */
  helperContext?: { parameters: readonly string[]; arguments: readonly string[] }
}): { prepare: string; evaluate: string; outputs: string[]; helpers: string } {
  const { nodes, outputs } = graph(program), wgsl = options.language === 'wgsl'
  const scopes: Scope[] = [{ parent: 0, depth: 0, nodes: [] }], placement = new Int32Array(nodes.length).fill(-1)
  const branches = new Map<number, [number, number]>(), invariant = new Uint8Array(nodes.length)
  const lca = (left: number, right: number) => {
    while (scopes[left]!.depth > scopes[right]!.depth) left = scopes[left]!.parent
    while (scopes[right]!.depth > scopes[left]!.depth) right = scopes[right]!.parent
    while (left !== right) { left = scopes[left]!.parent; right = scopes[right]!.parent }
    return left
  }
  const demand = (id: number, scope: number) => { placement[id] = placement[id] === -1 ? scope : lca(placement[id]!, scope) }
  outputs.forEach((id) => demand(id, 0))
  for (let id = nodes.length - 1; id >= 0; id--) {
    const scope = placement[id]!, node = nodes[id]!
    if (scope < 0 || node.op === ScalarOp.constant || node.op === ScalarOp.input) continue
    demand(node.a, scope)
    if (node.op === ScalarOp.select) {
      const yes = scopes.length, no = yes + 1
      scopes.push({ parent: scope, depth: scopes[scope]!.depth + 1, nodes: [] }, { parent: scope, depth: scopes[scope]!.depth + 1, nodes: [] })
      branches.set(id, [yes, no]); demand(node.b, yes); demand(node.c, no)
    } else { demand(node.b, scope); demand(node.c, scope) }
  }
  for (let id = 0; id < nodes.length; id++) {
    const node = nodes[id]!
    invariant[id] = Number(node.op === ScalarOp.constant || (node.op === ScalarOp.input ? options.invariant?.(node.a) : invariant[node.a] && invariant[node.b] && invariant[node.c]))
    if (placement[id]! >= 0) scopes[placement[id]!]!.nodes.push(id)
  }
  const ref = (id: number) => `v${id}`
  const number = (value: number) => {
    if (!wgsl) return Object.is(value, -0) ? '-0' : String(value)
    const f32 = Math.fround(value)
    if (!Number.isFinite(f32) || Object.is(f32, -0)) {
      const bytes = new Float32Array([f32])
      return `bitcast<f32>(${new Uint32Array(bytes.buffer)[0]}u)`
    }
    const text = String(f32)
    return /[.e]/i.test(text) ? text : `${text}.0`
  }
  const expression = (node: Expression): string => {
    const a = ref(node.a), b = ref(node.b)
    switch (node.op) {
      case ScalarOp.constant: return number(node.value)
      case ScalarOp.input: return options.input(node.a)
      case ScalarOp.add: return `${a} + ${b}`
      case ScalarOp.sub: return `${a} - ${b}`
      case ScalarOp.mul: return `${a} * ${b}`
      case ScalarOp.div: return `${a} / ${b}`
      case ScalarOp.min: case ScalarOp.max: return wgsl ? `portable${node.op === ScalarOp.min ? 'Min' : 'Max'}(${a}, ${b})` : `Math.${node.op === ScalarOp.min ? 'min' : 'max'}(${a}, ${b})`
      case ScalarOp.floor: case ScalarOp.ceil: case ScalarOp.abs: return `${wgsl ? '' : 'Math.'}${node.op === ScalarOp.floor ? 'floor' : node.op === ScalarOp.ceil ? 'ceil' : 'abs'}(${a})`
      case ScalarOp.round: return wgsl ? `portableRound(${a})` : `Math.round(${a})`
      case ScalarOp.eq: return wgsl ? `select(0.0, 1.0, portableEqual(${a}, ${b}))` : `(Object.is(${a}, ${b}) ? 1 : 0)`
      case ScalarOp.ne: return wgsl ? `select(0.0, 1.0, !portableEqual(${a}, ${b}))` : `(Object.is(${a}, ${b}) ? 0 : 1)`
      case ScalarOp.lt: case ScalarOp.le: return wgsl ? `select(0.0, 1.0, ${a} ${node.op === ScalarOp.lt ? '<' : '<='} ${b})` : `(${a} ${node.op === ScalarOp.lt ? '<' : '<='} ${b} ? 1 : 0)`
      case ScalarOp.pow: return wgsl ? `pow(${a}, ${b})` : `${a} ** ${b}`
      case ScalarOp.finite: return wgsl ? `select(0.0, 1.0, (bitcast<u32>(${a}) & 0x7fffffffu) < 0x7f800000u)` : `(Number.isFinite(${a}) ? 1 : 0)`
      case ScalarOp.nan: return wgsl ? `select(0.0, 1.0, portableNan(${a}))` : `(Number.isNaN(${a}) ? 1 : 0)`
      default: throw new Error(`Cannot emit scalar opcode ${node.op}`)
    }
  }
  // leave headroom for the surrounding scorer loop and parser expression
  // nesting. each extracted function starts a fresh statement-depth budget.
  const helpers: string[] = []
  const extracted = new Set<number>()
  const helper = (id: number): string => {
    const declared = new Set([id]), pending = [...branches.get(id)!]
    while (pending.length) {
      const scope = scopes[pending.pop()!]!
      for (const child of scope.nodes) {
        declared.add(child)
        const nested = branches.get(child)
        if (nested) pending.push(...nested)
      }
    }
    const free = new Set<number>()
    for (const child of declared) {
      const node = nodes[child]!
      if (node.op === ScalarOp.constant || node.op === ScalarOp.input) continue
      for (const dependency of [node.a, node.b, node.c]) if (!declared.has(dependency)) free.add(dependency)
    }
    const captures = [...free].sort((a, b) => a - b)
    const name = `portableScope${id}`, values = `PortableScope${id}Values`
    if (!extracted.has(id)) {
      extracted.add(id)
      const parameters = [...options.helperContext?.parameters ?? []]
      if (captures.length) parameters.push(`captured: ${values}`)
      const declarations = captures.map((capture) => `let ${ref(capture)} = captured.${ref(capture)};`).join('\n')
      const structure = captures.length ? `struct ${values} { ${captures.map((capture) => `${ref(capture)}: f32,`).join(' ')} }` : ''
      helpers.push(`${structure}\nfn ${name}(${parameters.join(', ')}) -> f32 {\n${declarations}\n${emitSelect(id, 0)}\nreturn ${ref(id)};\n}`)
    }
    const args = [...options.helperContext?.arguments ?? []]
    if (captures.length) args.push(`${values}(${captures.map(ref).join(', ')})`)
    return `let ${ref(id)} = ${name}(${args.join(', ')});`
  }
  const emitSelect = (id: number, depth: number): string => {
    if (wgsl && depth >= SHADER_BRANCH_DEPTH) return helper(id)
    const node = nodes[id]!, [yes, no] = branches.get(id)!
    return [`${wgsl ? 'var' : 'let'} ${ref(id)}${wgsl ? ': f32' : ''} = 0.0;`, `if (${ref(node.a)} != 0.0) {`, emit(yes, undefined, depth + 1), `${ref(id)} = ${ref(node.b)};`, '} else {', emit(no, undefined, depth + 1), `${ref(id)} = ${ref(node.c)};`, '}'].join('\n')
  }
  const emit = (scope: number, filter?: boolean, depth = 0): string => {
    const lines: string[] = []
    for (const id of scopes[scope]!.nodes) {
      if (filter !== undefined && Boolean(invariant[id]) !== filter) continue
      const node = nodes[id]!
      if (node.op !== ScalarOp.select) lines.push(`let ${ref(id)} = ${expression(node)};`)
      else lines.push(emitSelect(id, depth))
    }
    return lines.join('\n')
  }
  const prepare = emit(0, true), evaluate = emit(0, false)
  return { prepare, evaluate, outputs: outputs.map(ref), helpers: helpers.join('\n') }
}
