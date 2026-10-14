/*
  Author: Runor Ewhro
  description: keeps unsheeted modifier values separate from their scoped additions.
*/

import { describe, expect, it } from 'vitest'
import type { StatTreeNode } from '@/modules/simulation/model/statsView.ts'
import { makeStatResidue } from '../statResidue.ts'

describe('modulation stat residue', () => {
  it('keeps unconditional values and identically named scopes distinct', () => {
    const tree: StatTreeNode[] = [
      {
        kind: 'branch', key: 'combat', label: 'Combat', children: [
          { kind: 'leaf', key: 'defIgnore', label: 'DEF Ignore', value: 8, displayValue: '8%' },
        ],
      },
      {
        kind: 'branch', key: 'attribute', label: 'Attribute', children: [
          { kind: 'branch', key: 'all', label: 'All-Attribute', children: [
            { kind: 'leaf', key: 'defIgnore', label: 'DEF Ignore', value: 10, displayValue: '+10%' },
          ] },
        ],
      },
      {
        kind: 'branch', key: 'skillType', label: 'Skill Type', children: [
          { kind: 'branch', key: 'all', label: 'All Skills', children: [
            { kind: 'leaf', key: 'defIgnore', label: 'DEF Ignore', value: 12, displayValue: '+12%' },
          ] },
        ],
      },
    ]

    const residue = makeStatResidue(tree)
    expect(residue.rows).toEqual([expect.objectContaining({
      key: 'defIgnore',
      value: 8,
      scoped: [
        expect.objectContaining({ id: 'attribute:all:defIgnore', scopeKind: 'attribute', value: 10 }),
        expect.objectContaining({ id: 'skillType:all:defIgnore', scopeKind: 'skillType', value: 12 }),
      ],
    })])
  })
})
