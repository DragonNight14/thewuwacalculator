/*
  Author: Runor Ewhro
  Description: Protects the generated skills and localized calculator effects
               for the beta Unison Echoes.
*/

import { describe, expect, it } from 'vitest'
import type { SrcPkg } from '@/domain/gameData/contracts'
import betaEchoSourcesRaw from '../../../../public/data/beta/echoes/sources.json?raw'

function getEchoSource(sources: SrcPkg[], echoId: string): SrcPkg {
  const source = sources.find((candidate) => candidate.source.type === 'echo' && candidate.source.id === echoId)
  expect(source, `echo ${echoId} is missing its generated source package`).toBeDefined()
  return source as SrcPkg
}

describe('beta Unison Echo source invariants', () => {
  const sources = JSON.parse(betaEchoSourcesRaw) as SrcPkg[]

  it('keeps every new Echo skill and its localized element assignment', () => {
    expect(['6000219', '6000220', '6000222', '6000223', '6000224', '6000225'].map((id) => {
      const source = getEchoSource(sources, id)
      return [id, source.skills?.map((skill) => skill.element)]
    })).toEqual([
      ['6000219', ['fusion']],
      ['6000220', ['aero']],
      ['6000222', ['glacio']],
      ['6000223', ['fusion']],
      ['6000224', ['electro']],
      ['6000225', ['electro', 'electro']],
    ])
  })

  it('authors the Chinese-only main-slot and handoff effects', () => {
    expect(getEchoSource(sources, '6000223').effects).toContainEqual(expect.objectContaining({
      targetScope: 'self',
      operations: [expect.objectContaining({ type: 'add_top_stat', stat: 'energyRegen', value: { type: 'const', value: 10 } })],
    }))
    expect(getEchoSource(sources, '6000224').effects).toContainEqual(expect.objectContaining({
      targetScope: 'activeOther',
      operations: [expect.objectContaining({
        type: 'add_attribute_mod', attribute: 'electro', mod: 'dmgBonus', value: { type: 'const', value: 12 },
      })],
    }))
  })

  it('switches the signature Echo multiplier only for Hsin', () => {
    const skills = getEchoSource(sources, '6000225').skills ?? []

    expect(skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        multiplier: 2.7359999999999998,
        visibleWhen: { type: 'not', value: { type: 'eq', from: 'sourceRuntime', path: 'id', value: '1311' } },
      }),
      expect.objectContaining({
        multiplier: 3.0096000000000003,
        visibleWhen: { type: 'eq', from: 'sourceRuntime', path: 'id', value: '1311' },
      }),
    ]))
  })
})
