import { describe, expect, it } from 'vitest'
import type { EffectDef } from '@/domain/gameData/contracts.ts'
import {
  classifyEffectActivation,
  isBuildBoundEffect,
} from '@/domain/gameData/effectActivation.ts'

function effect(patch: Partial<EffectDef> = {}): EffectDef {
  return {
    id: 'test:effect',
    label: 'Test effect',
    source: { type: 'resonator', id: 'test' },
    trigger: 'runtime',
    operations: [{
      type: 'add_top_stat',
      stat: 'critRate',
      value: { type: 'const', value: 10 },
    }],
    ...patch,
  }
}

describe('effect activation classification', () => {
  it('recognizes constant self effects as passive', () => {
    expect(classifyEffectActivation(effect())).toBe('passive')
    expect(isBuildBoundEffect(effect())).toBe(true)
  })

  it('keeps level, sequence, rank, and final-stat dependencies build-bound', () => {
    expect(classifyEffectActivation(effect({
      condition: { type: 'gte', from: 'sourceRuntime', path: 'base.sequence', value: 2 },
    }))).toBe('buildConditional')

    expect(classifyEffectActivation(effect(), {
      unlockWhen: { type: 'gte', from: 'sourceRuntime', path: 'base.level', value: 70 },
    })).toBe('buildConditional')

    expect(classifyEffectActivation(effect({
      operations: [{
        type: 'add_base_stat',
        stat: 'atk',
        field: 'percent',
        value: { type: 'table', from: 'sourceRuntime', path: 'build.weapon.rank', values: [0, 10] },
      }],
    }))).toBe('buildConditional')

    expect(classifyEffectActivation(effect({
      operations: [{
        type: 'add_top_stat',
        stat: 'critRate',
        value: { type: 'read', from: 'finalStats', path: 'energyRegen' },
      }],
    }))).toBe('buildConditional')
  })

  it('rejects unconditional wrappers whose values still read combat controls', () => {
    const controlDriven = effect({
      operations: [{
        type: 'add_top_stat',
        stat: 'critDmg',
        value: {
          type: 'read',
          from: 'sourceRuntime',
          path: 'state.controls.weapon:test:passive:stacks',
        },
      }],
    })

    expect(classifyEffectActivation(controlDriven)).toBe('combatConditional')
    expect(isBuildBoundEffect(controlDriven)).toBe(false)
  })

  it('treats enemy and unknown context dependencies conservatively as combat state', () => {
    expect(classifyEffectActivation(effect({
      condition: { type: 'truthy', from: 'context', path: 'enemy.status.vulnerable' },
    }))).toBe('combatConditional')
    expect(classifyEffectActivation(effect({
      condition: { type: 'truthy', path: 'futureRuntimeFlag' },
    }))).toBe('combatConditional')
    expect(classifyEffectActivation(effect(), {
      visibleWhen: { type: 'truthy', from: 'sourceRuntime', path: 'state.controls.test:active' },
    })).toBe('combatConditional')
  })

  it('separates active routing from build-bound targeting', () => {
    expect(classifyEffectActivation(effect({ targetScope: 'active' }))).toBe('activeTargeted')
    expect(classifyEffectActivation(effect({ targetScope: 'activeOther' }))).toBe('activeTargeted')
    expect(classifyEffectActivation(effect({ targetScope: 'teamWide' }))).toBe('passive')
  })
})
