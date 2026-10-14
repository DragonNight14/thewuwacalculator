/*
  Author: Runor Ewhro
  description: verifies the executionScope.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type {
  EditorBlock,
  EditorNode,
  EditorSection,
  EditorStep,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import {
  clampLoopRunSelections,
  findNodeExecutionScope,
  selectedRunForNode,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/executionScope.ts'

function step(id: string): EditorStep {
  return {
    type: 'step',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: id,
    index: 0,
    multiplier: 1,
    damageByRun: { 1: 1 },
    statsByRun: {},
    memberId: 'res-a',
    kindLabel: 'Skill',
    buffCount: 0,
  }
}

function loop(id: string, label: string, runs: number, children: EditorNode[]): EditorBlock {
  return {
    type: 'loop',
    id: `${id}-start`,
    loopId: id,
    owner: { kind: 'member', memberId: 'res-a' },
    label,
    runs,
    nodeCount: children.length,
    children,
  }
}

describe('rotation editor execution scopes', () => {
  it('keeps sections and sibling loop selections independent', () => {
    const preambleStep = step('opening')
    const mainStep = step('main-step')
    const loopAStep = step('loop-a-step')
    const loopBStep = step('loop-b-step')
    const sections: EditorSection[] = [
      { id: 'preamble', title: 'Preamble', meta: '', children: [preambleStep] },
      {
        id: 'main',
        title: 'Main',
        meta: '',
        children: [
          mainStep,
          loop('loop-a', 'Opener', 2, [loopAStep]),
          loop('loop-b', 'Burst', 4, [loopBStep]),
        ],
      },
    ]
    const selections = clampLoopRunSelections(sections, {
      'loop-a': 2,
      'loop-b': 3,
      stale: 9,
    })

    expect(selections).toEqual({ 'loop-a': 2, 'loop-b': 3 })
    expect(findNodeExecutionScope(sections, preambleStep.id, selections)).toEqual({
      kind: 'section',
      sectionId: 'preamble',
      sectionLabel: 'Preamble',
    })
    expect(findNodeExecutionScope(sections, mainStep.id, selections)).toEqual({
      kind: 'section',
      sectionId: 'main',
      sectionLabel: 'Main',
    })
    expect(findNodeExecutionScope(sections, loopAStep.id, selections)).toMatchObject({
      kind: 'loop',
      loopId: 'loop-a',
      loopLabel: 'Opener',
      run: 2,
      runs: 2,
    })
    expect(findNodeExecutionScope(sections, loopBStep.id, selections)).toMatchObject({
      kind: 'loop',
      loopId: 'loop-b',
      loopLabel: 'Burst',
      run: 3,
      runs: 4,
    })
    expect(selectedRunForNode(sections, loopAStep.id, selections)).toBe(2)
    expect(selectedRunForNode(sections, loopBStep.id, selections)).toBe(3)
  })

  it('keeps a free loop scope active inside a block until its nested end segment', () => {
    const start = loop('free', 'Free', 3, [])
    start.wrap = 'tail'
    start.loopSegment = 'start'

    const target = step('target')
    const end = {
      ...loop('free-end', 'Free', 3, [target]),
      id: 'free-start:segment:1',
      loopId: 'free',
      wrap: 'head' as const,
      wrapOf: start.id,
      loopSegment: 'end' as const,
    }
    const repeat: EditorBlock = {
      type: 'repeat',
      id: 'repeat',
      owner: { kind: 'member', memberId: 'res-a' },
      label: 'Repeat',
      runs: 2,
      nodeCount: 2,
      children: [end, step('nested-after')],
    }
    const sections: EditorSection[] = [{
      id: 'main',
      title: 'Main',
      meta: '',
      children: [start, repeat, step('after')],
    }]

    expect(findNodeExecutionScope(sections, repeat.id, { free: 2 })).toMatchObject({
      kind: 'loop',
      loopId: 'free',
      run: 2,
    })
    expect(findNodeExecutionScope(sections, target.id, { free: 3 })).toMatchObject({
      kind: 'loop',
      loopId: 'free',
      run: 3,
    })
    expect(findNodeExecutionScope(sections, 'nested-after', { free: 2 })).toMatchObject({
      kind: 'section',
    })
    expect(findNodeExecutionScope(sections, 'after', { free: 2 })).toMatchObject({
      kind: 'section',
    })
  })
})
