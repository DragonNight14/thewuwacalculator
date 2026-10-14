/*
  Author: Runor Ewhro
  description: protects the generated skills and localized calculator effects
               for the beta unison echoes.
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

  it('switches the signature Echo multiplier only for Hsin', () => {
    const skills = getEchoSource(sources, '6000225').skills ?? []

    expect(skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        multiplier: 2.7359999999999998,
        visibleWhen: { type: 'not', value: { type: 'eq', from: 'sourceRuntime', path: 'id', value: '1311' } },
      }),
      expect.objectContaining({
        multiplier: 2.7356,
        visibleWhen: { type: 'eq', from: 'sourceRuntime', path: 'id', value: '1311' },
      }),
    ]))
  })
})
