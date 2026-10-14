/*
  Author: Runor Ewhro
  description: protects off-tune landing authoring before a rotation is run.
*/

import { describe, expect, it } from 'vitest'
import type { EditorSection, EditorStep } from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import { offTuneAuthoringStates } from '@/modules/simulation/surfaces/rotation/program-editor/presentation/registerRows.ts'

function step(id: string): EditorStep {
  return {
    type: 'step',
    id,
    owner: { kind: 'member', memberId: 'res-a' },
    label: id,
    index: 0,
    featureId: id,
    multiplier: 1,
    damageByRun: {},
    statsByRun: {},
    memberId: 'res-a',
    kindLabel: 'Skill',
    buffCount: 0,
  }
}

function section(children: EditorSection['children']): EditorSection[] {
  return [{ id: 'main', title: 'Main', meta: '', children }]
}

describe('Off-Tune authoring state', () => {
  it('updates the editable seal immediately and keeps later rows as landing targets', () => {
    const resume = { ...step('resume'), offTuneResume: true }
    const states = offTuneAuthoringStates(section([
      { ...step('break'), kindLabel: 'tuneBreak' },
      step('held-1'),
      step('held-2'),
      step('held-3'),
      step('held-4'),
      resume,
      step('later'),
    ]))

    expect(states.get('held-4')).toEqual({ sealed: true, canResume: true, resume: null })
    expect(states.get('resume')).toEqual({ sealed: false, canResume: true, resume: 'mark' })
    expect(states.get('later')).toEqual({ sealed: false, canResume: true, resume: null })
  })

  it('draws the three-row default without requiring a run', () => {
    const states = offTuneAuthoringStates(section([
      { ...step('break'), kindLabel: 'tuneBreak' },
      step('held-1'),
      step('held-2'),
      step('held-3'),
      step('default'),
      step('later'),
    ]))

    expect(['held-1', 'held-2', 'held-3'].map((id) => states.get(id)?.sealed)).toEqual([
      true,
      true,
      true,
    ])
    expect(states.get('default')?.resume).toBe('default')
    expect(states.get('later')?.canResume).toBe(true)
  })
})
