/*
  Author: Runor Ewhro
  description: verifies clean rotation plans remove only candidate-owned Echo
               control writes while retaining fixed teammate setup.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { normalizeRotationForCleanContext } from '@/engine/rotation/damagePlan.ts'

function condition(id: string, resonatorId: string, path: string): RotationNode {
  return {
    id,
    type: 'condition',
    resonatorId,
    changes: [{ type: 'set', path, value: false, resonatorId }],
  }
}

describe('clean-context rotation damage plans', () => {
  it('removes only the searched resonator Echo-control writes, including nested writes', () => {
    const items: RotationNode[] = [
      condition('context-set', '1509', 'runtime.state.controls.echoSet:24:bonus:neonlightLeap5'),
      condition('context-echo', '1509', 'runtime.state.controls.echo:6000189:main:active'),
      condition('teammate-set', '1209', 'runtime.state.controls.echoSet:25:bonus:starryRadiance5pc'),
      {
        id: 'repeat',
        type: 'repeat',
        times: 2,
        items: [
          condition('nested-context-set', '1509', 'runtime.state.controls.echoSet:24:bonus:neonlightLeapOffTune'),
          condition('nested-teammate-set', '1209', 'runtime.state.controls.echoSet:25:bonus:starryRadiance5pc'),
        ],
      },
    ]

    const normalized = normalizeRotationForCleanContext(items, '1509')
    const ids = (nodes: readonly RotationNode[]): string[] => nodes.flatMap((node) => [
      node.id,
      ...(node.type === 'repeat' ? ids(node.items) : []),
    ])

    expect(ids(normalized)).toEqual(['teammate-set', 'repeat', 'nested-teammate-set'])
  })
})
