import { describe, expect, it } from 'vitest'
import type { EffectOp, EffectScope, FormExpr } from '@/domain/gameData/contracts.ts'
import type { SkillDef } from '@/domain/entities/stats.ts'
import { applySkllOp } from '@/engine/effects/dataEffects.ts'
import { evalCond, evalForm } from '@/engine/effects/evaluator.ts'

function makeScope(context: Record<string, unknown>): EffectScope {
  return {
    sourceRuntime: {} as EffectScope['sourceRuntime'],
    targetRuntime: {} as EffectScope['targetRuntime'],
    activeRuntime: {} as EffectScope['activeRuntime'],
    context: context as unknown as EffectScope['context'],
  }
}

describe('compiled expression evaluator', () => {
  it('executes nested formula programs from typed postfix instructions', () => {
    const formula: FormExpr = {
      type: 'clamp',
      min: 0,
      max: 50,
      value: {
        type: 'mul',
        values: [
          {
            type: 'add',
            values: [
              { type: 'read', path: 'context.base', default: 1 },
              { type: 'const', value: 2 },
            ],
          },
          {
            type: 'table',
            path: 'context.stacks',
            values: [1, 3, 5],
            minIndex: 1,
          },
        ],
      },
    }
    const scope = makeScope({ base: 4, stacks: 2 })

    expect(evalForm(formula, scope)).toBe(18)
    // A second execution reuses the same compiled program and numeric stack.
    expect(evalForm(formula, scope)).toBe(18)
  })

  it('preserves boolean short-circuiting and compiled includes paths', () => {
    const scope = makeScope({
      enabled: true,
      rows: [{ id: 'first' }, { id: 'target' }],
    })
    Object.defineProperty(scope, 'sourceFinalStats', {
      get(): never {
        throw new Error('short-circuited branch should not be read')
      },
    })

    expect(evalCond({
      type: 'or',
      values: [
        { type: 'truthy', path: 'context.enabled' },
        { type: 'gt', from: 'sourceFinalStats', path: 'atk.final', value: 0 },
      ],
    }, scope)).toBe(true)
    expect(evalCond({
      type: 'includes',
      path: 'context.rows',
      value: 'target',
      itemPath: 'id',
    }, scope)).toBe(true)
  })

  it('intersects skill type, element, and label match dimensions', () => {
    const baseSkill: SkillDef = {
      id: 'liberation',
      label: 'Liberation Dodge Counter',
      tab: 'resonanceLiberation',
      element: 'fusion',
      skillType: ['resonanceLiberation'],
      archetype: 'skillDamage',
      aggregationType: 'damage',
      scaling: { atk: 1, hp: 0, def: 0, energyRegen: 0 },
      multiplier: 1,
      flat: 0,
      hits: [{ count: 1, multiplier: 1 }],
    }
    const operation: EffectOp = {
      type: 'add_skill_mod',
      match: {
        skillTypes: ['resonanceLiberation'],
        elements: ['fusion'],
        labelIncludes: ['Dodge Counter'],
      },
      mod: 'resShred',
      value: { type: 'const', value: 10 },
    }
    const scope = makeScope({})

    expect(applySkllOp(baseSkill, operation, scope).skillBuffs?.resShred).toBe(10)
    expect(applySkllOp({ ...baseSkill, element: 'glacio' }, operation, scope).skillBuffs?.resShred).toBeUndefined()
    expect(applySkllOp({ ...baseSkill, skillType: ['basicAtk'] }, operation, scope).skillBuffs?.resShred).toBeUndefined()
    expect(applySkllOp({ ...baseSkill, label: 'Liberation' }, operation, scope).skillBuffs?.resShred).toBeUndefined()
  })
})
