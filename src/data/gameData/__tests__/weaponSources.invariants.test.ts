/*
  Author: Runor Ewhro
  description: protects generated weapon effects against omitted operations
               and disconnected state.
*/

import { describe, expect, it } from 'vitest'
import type { SrcPkg } from '@/domain/gameData/contracts.ts'
import betaSourcesRaw from '../../../../public/data/beta/weapons/sources.json?raw'
import liveSourcesRaw from '../../../../public/data/live/weapons/sources.json?raw'

const MODES = [
  ['beta', betaSourcesRaw],
  ['live', liveSourcesRaw],
] as const

const NIGHT_WEAPONS = ['21010013', '21020013', '21030013', '21040013', '21050013'] as const
const STACK_ONLY_WEAPONS = [
  '21010094',
  '21020094',
  '21030094',
  '21040094',
  '21050094',
  '21050027',
] as const

function weaponSource(sources: SrcPkg[], id: string): SrcPkg {
  const source = sources.find((candidate) => candidate.source.type === 'weapon' && candidate.source.id === id)
  if (!source) throw new Error(`Missing generated weapon source ${id}`)
  return source
}

function collectControlPaths(value: unknown, paths = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return paths
  if (Array.isArray(value)) {
    for (const entry of value) collectControlPaths(entry, paths)
    return paths
  }

  const record = value as Record<string, unknown>
  if (
    record.from === 'sourceRuntime' &&
    typeof record.path === 'string' &&
    record.path.startsWith('state.controls.weapon:')
  ) {
    paths.add(record.path)
  }
  for (const entry of Object.values(record)) collectControlPaths(entry, paths)
  return paths
}

describe('generated weapon source invariants', () => {
  it.each(MODES)('%s keeps every authored control connected to its effects', (_mode, sourcesRaw) => {
    const sources = JSON.parse(sourcesRaw) as SrcPkg[]

    for (const source of sources.filter((candidate) => candidate.source.type === 'weapon')) {
      const declared = new Set((source.states ?? []).map((state) => state.path.replace(/^runtime\./, '')))
      const referenced = collectControlPaths(source.effects ?? [])

      expect(
        [...referenced].filter((path) => !declared.has(path)),
        `${source.source.id} references an undeclared weapon control`,
      ).toEqual([])
      expect(
        [...declared].filter((path) => !referenced.has(path)),
        `${source.source.id} declares a weapon control that no effect reads`,
      ).toEqual([])
    }
  })

  it('authors the beta Unison weapon passives without stacking the two mind states', () => {
    const sources = JSON.parse(betaSourcesRaw) as SrcPkg[]
    const rue = weaponSource(sources, '21020107')
    const jadehaven = weaponSource(sources, '21050116')

    expect(rue.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'weapon:21020107:binding-mind',
        targetScope: 'teamWide',
        condition: {
          type: 'and',
          values: [
            { type: 'truthy', from: 'sourceRuntime', path: 'state.controls.weapon:21020107:passive:unison' },
            {
              type: 'not',
              value: { type: 'truthy', from: 'sourceRuntime', path: 'state.controls.weapon:21020107:passive:yearning_mind' },
            },
          ],
        },
      }),
      expect.objectContaining({
        id: 'weapon:21020107:yearning-mind',
        targetScope: 'self',
        operations: [expect.objectContaining({ value: expect.objectContaining({ values: [40, 50, 60, 70, 80] }) })],
      }),
    ]))

    expect(jadehaven.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'weapon:21050116:skill',
        operations: expect.arrayContaining([
          expect.objectContaining({ type: 'add_skilltype_mod', skillType: 'resonanceSkill', mod: 'amplify' }),
          expect.objectContaining({
            type: 'add_skill_mod',
            match: { skillTypes: ['resonanceSkill'], elements: ['electro'] },
            mod: 'resShred',
          }),
        ]),
      }),
      expect.objectContaining({
        id: 'weapon:21050116:electro-flare',
        targetScope: 'teamWide',
        operations: [expect.objectContaining({ skillType: 'electroFlare', mod: 'amplify' })],
      }),
    ]))
  })

  it.each(MODES)('%s authors Everbright Polestar as Fusion Liberation RES ignore', (_mode, sourcesRaw) => {
    const source = weaponSource(JSON.parse(sourcesRaw) as SrcPkg[], '21020076')
    const effect = source.effects?.find((candidate) => candidate.id === 'weapon:21020076:defignore')

    expect(effect).toMatchObject({
      condition: {
        type: 'truthy',
        from: 'sourceRuntime',
        path: 'state.controls.weapon:21020076:passive:active',
      },
      operations: [
        {
          type: 'add_skilltype_mod',
          skillType: 'resonanceLiberation',
          mod: 'defIgnore',
          value: { type: 'table', values: [32, 40, 48, 56, 64] },
        },
        {
          type: 'add_skill_mod',
          match: { skillTypes: ['resonanceLiberation'], elements: ['fusion'] },
          mod: 'resShred',
          value: { type: 'table', values: [10, 15, 20, 25, 30] },
        },
      ],
    })
  })

  it.each(MODES)('%s keeps corrected rank tables and formerly omitted operations', (_mode, sourcesRaw) => {
    const sources = JSON.parse(sourcesRaw) as SrcPkg[]

    for (const id of NIGHT_WEAPONS) {
      const atk = weaponSource(sources, id).effects
          ?.flatMap((effect) => effect.operations)
          .find((operation) => operation.type === 'add_base_stat' && operation.stat === 'atk')
      expect(atk, id).toMatchObject({ value: { type: 'table', values: [8, 10, 12, 14, 16] } })
    }

    expect(weaponSource(sources, '21010044').effects?.[0]?.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'add_base_stat', stat: 'atk', field: 'percent',
        value: expect.objectContaining({ values: [8, 10, 12, 14, 16] }),
      }),
      expect.objectContaining({
        type: 'add_base_stat', stat: 'def', field: 'percent',
        value: expect.objectContaining({ values: [15, 18.75, 22.5, 26.25, 30] }),
      }),
    ]))

    expect(weaponSource(sources, '21020026')).toEqual(expect.objectContaining({
      effects: expect.arrayContaining([
        expect.objectContaining({
          id: 'weapon:21020026:basic_stacks',
          operations: [expect.objectContaining({
            value: expect.objectContaining({
              type: 'mul',
              values: expect.arrayContaining([
                expect.objectContaining({ type: 'table', values: [10, 12.5, 15, 17.5, 20] }),
              ]),
            }),
          })],
        }),
      ]),
    }))

    expect(weaponSource(sources, '21040034')).toEqual(expect.objectContaining({
      effects: expect.arrayContaining([
        expect.objectContaining({
          operations: expect.arrayContaining([
            expect.objectContaining({
              type: 'add_skill_mod',
              match: { labelIncludes: ['Dodge Counter'] },
              mod: 'dmgBonus',
              value: expect.objectContaining({ values: [50, 62.5, 75, 87.5, 100] }),
            }),
          ]),
        }),
      ]),
    }))
  })

  it.each(MODES)('%s keeps automatic and stack-only gates independent', (_mode, sourcesRaw) => {
    const sources = JSON.parse(sourcesRaw) as SrcPkg[]
    const defier = weaponSource(sources, '21020056')
    const luminous = weaponSource(sources, '21050046')

    expect(defier.states?.map((state) => state.id)).toEqual(['defignore'])
    expect(defier.effects?.find((effect) => effect.id === 'weapon:21020056:amplify')?.condition).toEqual({
      type: 'gt', from: 'sourceRuntime', path: 'state.combat.aeroErosion', value: 0,
    })

    expect(luminous.effects?.find((effect) => effect.id === 'weapon:21050046:dmg')).not.toHaveProperty('condition')
    expect(luminous.effects?.find((effect) => effect.id === 'weapon:21050046:frazzle')?.condition).toMatchObject({
      path: 'state.controls.weapon:21050046:passive:active',
    })

    for (const id of STACK_ONLY_WEAPONS) {
      const source = weaponSource(sources, id)
      expect(source.states?.map((state) => state.id), id).toEqual(['stacks'])
      expect(source.effects?.some((effect) => effect.condition), id).toBe(false)
    }
  })
})
