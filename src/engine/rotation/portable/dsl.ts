/*
  Author: Runor Ewhro
  description: resolves runtime values, conditions, and formulas into portable
               scalar expressions while preserving dynamic branches.
*/

import type { CondExpr, EvalScpRoot, FormExpr } from '@/domain/gameData/contracts'
import { ScalarBuilder, ScalarOp, type Scalar } from './ir'

export interface PortableValue { kind: Scalar; data: Scalar; raw?: unknown; choice?: { condition: Scalar; yes: PortableValue; no: PortableValue } }
export type ScopeReader = (from: EvalScpRoot, path: string) => PortableValue
export type ScaleReader = (from: EvalScpRoot, path: string) => Scalar

export class PortableDsl {
  readonly symbols = new Map<string, number>([['', 0]])
  readonly ir: ScalarBuilder
  constructor(ir: ScalarBuilder) { this.ir = ir }
  literal(value: unknown): PortableValue {
    const { ir } = this
    if (typeof value === 'number') return { kind: ir.one, data: ir.constant(value), raw: value }
    if (typeof value === 'boolean') return { kind: ir.constant(2), data: value ? ir.one : ir.zero, raw: value }
    if (typeof value === 'string') {
      let symbol = this.symbols.get(value)
      if (symbol === undefined) { symbol = this.symbols.size; this.symbols.set(value, symbol) }
      return { kind: ir.constant(3), data: ir.constant(symbol), raw: value }
    }
    return { kind: ir.constant(value === undefined || value === null ? 0 : 4), data: ir.zero, raw: value }
  }
  number(value: PortableValue): Scalar {
    return this.numberOr(value, this.ir.zero)
  }
  private numberOr(value: PortableValue, fallback: Scalar): Scalar {
    const { ir } = this
    const kind = ir.value(value.kind)
    if (kind === 1 || kind === 2) return ir.select(ir.operation(ScalarOp.finite, value.data), value.data, fallback)
    if (kind === 0 || kind === 4) return fallback
    if (typeof value.raw === 'string') return Number.isFinite(Number(value.raw)) ? ir.constant(Number(value.raw)) : fallback
    let string = fallback
    for (const [text, symbol] of this.symbols) {
      const number = Number(text)
      if (Number.isFinite(number)) string = ir.select(ir.eq(value.data, ir.constant(symbol)), ir.constant(number), string)
    }
    return ir.select(ir.eq(value.kind, ir.constant(3)), string,
      ir.select(ir.and(ir.or(ir.eq(value.kind, ir.one), ir.eq(value.kind, ir.constant(2))), ir.operation(ScalarOp.finite, value.data)), value.data, fallback))
  }
  truthy(value: PortableValue): Scalar {
    const { ir } = this
    if (ir.value(value.kind) === 3 && typeof value.raw === 'string') return value.raw ? ir.one : ir.zero
    return ir.select(ir.eq(value.kind, ir.constant(4)), ir.one,
      ir.and(ir.not(ir.eq(value.kind, ir.zero)), ir.and(ir.not(ir.eq(value.data, ir.zero)), ir.not(ir.operation(ScalarOp.nan, value.data)))))
  }
  choose(condition: Scalar, yes: PortableValue, no: PortableValue): PortableValue {
    const known = this.ir.value(condition)
    if (known !== undefined) return known ? yes : no
    return { kind: this.ir.select(condition, yes.kind, no.kind), data: this.ir.select(condition, yes.data, no.data),
      ...((yes.choice || no.choice || this.ir.value(yes.kind) === 4 || this.ir.value(no.kind) === 4) ? { choice: { condition, yes, no } } : {}),
    }
  }
  path(path: string, from?: EvalScpRoot): { path: string; from: EvalScpRoot } {
    if (from) return { from, path: path.replace(/^runtime\./, '') }
    for (const root of ['sourceRuntime', 'targetRuntime', 'activeRuntime', 'sourceFinalStats', 'finalStats', 'pool', 'baseStats', 'context'] as const) {
      if (path.startsWith(`${root}.`)) return { from: root, path: path.slice(root.length + 1) }
    }
    return path.startsWith('runtime.') ? { from: 'sourceRuntime', path: path.slice(8) } : { from: 'context', path }
  }
  formula(expression: FormExpr, read: ScopeReader, authored = false): Scalar {
    const { ir } = this
    if (expression.type === 'const') return ir.constant(expression.value)
    if (expression.type === 'add') return ir.sum(expression.values.map((value) => this.formula(value, read, authored)))
    if (expression.type === 'mul') return ir.product(expression.values.map((value) => this.formula(value, read, authored)))
    if (expression.type === 'clamp') {
      let value = this.formula(expression.value, read, authored)
      if (expression.min !== undefined) value = ir.max(ir.constant(expression.min), value)
      if (expression.max !== undefined) value = ir.min(ir.constant(expression.max), value)
      return value
    }
    const path = this.path(expression.path, expression.from)
    const value = read(path.from, path.path)
    const fallback = expression.type === 'read' ? expression.default ?? 0 : expression.defaultIndex ?? 0
    const number = authored ? this.numberOr(value, ir.constant(fallback)) : ir.select(ir.eq(value.kind, ir.zero), ir.constant(fallback), this.number(value))
    if (expression.type === 'read') return number
    const minimum = expression.minIndex ?? 0
    const maximum = expression.maxIndex ?? Math.max(minimum, minimum + expression.values.length - 1)
    const index = ir.sub(ir.clamp(ir.operation(ScalarOp.floor, number), minimum, maximum), ir.constant(minimum))
    return ir.table(index, expression.values)
  }
  condition(expression: CondExpr | undefined, read: ScopeReader, authored = false): Scalar {
    const { ir } = this
    if (!expression || expression.type === 'always') return ir.one
    if (expression.type === 'not') return ir.not(this.condition(expression.value, read, authored))
    if (expression.type === 'and') return expression.values.reduce((a, b) => ir.and(a, this.condition(b, read, authored)), ir.one)
    if (expression.type === 'or') return expression.values.reduce((a, b) => ir.or(a, this.condition(b, read, authored)), ir.zero)
    const path = this.path(expression.path, expression.from), actual = read(path.from, path.path)
    if (expression.type === 'truthy') return !authored && (path.from === 'sourceRuntime' || path.from === 'targetRuntime' || path.from === 'activeRuntime')
      ? ir.not(ir.eq(this.number(actual), ir.zero)) : this.truthy(actual)
    if (expression.type === 'includes') {
      const includes = (value: PortableValue): Scalar => {
        if (value.choice) return ir.select(value.choice.condition, includes(value.choice.yes), includes(value.choice.no))
        return Array.isArray(value.raw) && value.raw.some((item: unknown) => (expression.itemPath ? readObjectPath(item, expression.itemPath) : item) === expression.value) ? ir.one : ir.zero
      }
      return includes(actual)
    }
    const expected = this.literal(expression.value)
    if (expression.type === 'eq' || expression.type === 'neq') {
      const dataEqual = authored ? ir.and(ir.operation(ScalarOp.le, actual.data, expected.data), ir.operation(ScalarOp.le, expected.data, actual.data)) : ir.eq(actual.data, expected.data)
      const equal = ir.and(ir.eq(actual.kind, expected.kind), dataEqual)
      return expression.type === 'eq' ? equal : ir.not(equal)
    }
    const number = this.number(actual)
    if (expression.type === 'gt') return ir.operation(ScalarOp.lt, expected.data, number)
    if (expression.type === 'gte') return ir.operation(ScalarOp.le, expected.data, number)
    if (expression.type === 'lt') return ir.operation(ScalarOp.lt, number, expected.data)
    return ir.operation(ScalarOp.le, number, expected.data)
  }
  scale(expression: CondExpr | undefined, read: ScopeReader, scale: ScaleReader): Scalar {
    const { ir } = this
    if (!expression || expression.type === 'always' || expression.type === 'not') return ir.one
    if (expression.type === 'and') return expression.values.reduce((a, b) => ir.min(a, this.scale(b, read, scale)), ir.one)
    if (expression.type === 'or') {
      let found = ir.zero, value = ir.one
      for (const child of expression.values) {
        const applies = this.condition(child, read), amount = this.scale(child, read, scale)
        value = ir.select(applies, ir.select(found, ir.max(value, amount), amount), value)
        found = ir.or(found, applies)
      }
      return value
    }
    const path = this.path(expression.path, expression.from)
    return scale(path.from, path.path)
  }
  formulaScale(expression: FormExpr, scale: ScaleReader): Scalar {
    if (expression.type === 'const') return this.ir.one
    if (expression.type === 'add' || expression.type === 'mul') return expression.values.reduce((result, child) => this.ir.min(result, this.formulaScale(child, scale)), this.ir.one)
    if (expression.type === 'clamp') return this.formulaScale(expression.value, scale)
    const path = this.path(expression.path, expression.from)
    return scale(path.from, path.path)
  }
}

export function readObjectPath(value: unknown, path: string): unknown {
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return value
}
