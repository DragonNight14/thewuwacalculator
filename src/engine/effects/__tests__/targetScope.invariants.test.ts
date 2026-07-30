/*
  Author: Runor Ewhro
  Description: Locks active-target routing semantics for data-driven effects so
               teammate sources with the same owner key do not share selection.
*/

import { describe, expect, it } from 'vitest'
import type { EffectContext, EffectDef } from '@/domain/gameData/contracts.ts'
import { scopedTargetOwnerKey } from '@/domain/gameData/targetRouting.ts'
import { ffctTrgtRt, resFfctTgtId } from '@/engine/effects/targetScope.ts'

const effect: EffectDef = {
  id: 'active-other-test',
  label: 'Active Other Test',
  source: { type: 'echoSet', id: '30' },
  ownerKey: 'echoSet:30:bonus',
  trigger: 'runtime',
  targetScope: 'activeOther',
  operations: [],
}

function context(
  sourceId: string,
  targetId: string,
  selectedTargetsByOwnerKey: Record<string, string | null> = {},
): EffectContext {
  return {
    source: { type: 'echoSet', id: '30' },
    target: { type: 'resonator', id: targetId },
    sourceRuntime: { id: sourceId },
    targetRuntime: { id: targetId },
    activeRuntime: { id: 'hiyuki' },
    targetRuntimeId: targetId,
    activeResonatorId: 'hiyuki',
    teamMemberIds: ['hiyuki', 'lucilla', 'suisui'],
    echoSetCounts: { 30: 5 },
    selectedTargetsByOwnerKey,
  } as unknown as EffectContext
}

describe('effect target scope routing', () => {
  it('does not fall back to active when an explicit activeOther target is invalid for the source', () => {
    const selected = { 'echoSet:30:bonus': 'lucilla' }

    expect(resFfctTgtId(effect, context('hiyuki', 'lucilla', selected))).toBe('lucilla')
    expect(resFfctTgtId(effect, context('lucilla', 'hiyuki', selected))).toBeNull()
    expect(ffctTrgtRt(effect, context('lucilla', 'hiyuki', selected))).toBe(false)
  })

  it('supports independent target selections for multiple sources using the same owner key', () => {
    const selected = {
      [scopedTargetOwnerKey('hiyuki', 'echoSet:30:bonus')]: 'suisui',
      [scopedTargetOwnerKey('lucilla', 'echoSet:30:bonus')]: 'hiyuki',
    }

    expect(resFfctTgtId(effect, context('hiyuki', 'suisui', selected))).toBe('suisui')
    expect(resFfctTgtId(effect, context('lucilla', 'hiyuki', selected))).toBe('hiyuki')
    expect(ffctTrgtRt(effect, context('hiyuki', 'hiyuki', selected))).toBe(false)
    expect(ffctTrgtRt(effect, context('lucilla', 'suisui', selected))).toBe(false)
  })

  it('keeps the active fallback when no target was explicitly selected', () => {
    expect(resFfctTgtId(effect, context('lucilla', 'hiyuki'))).toBe('hiyuki')
    expect(ffctTrgtRt(effect, context('lucilla', 'hiyuki'))).toBe(true)
  })
})
