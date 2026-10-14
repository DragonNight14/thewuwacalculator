/*
  Author: Runor Ewhro
  description: verifies dual-set main echoes remain legal leaders for
               five-piece quick-build plans.
*/

import { describe, expect, it } from 'vitest'
import { getEchoById, listEchoes } from '@/data/catalog/echoCatalogService'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import { cmptSetCnts } from '../echoPane'
import { canMainEchoFitSetPlan, generateQuickBuild, makeQuickConfig } from '../quickSetup'

describe('five-piece quick-build plans', () => {
  it('keeps every eligible dual-set main Echo in its selected set', () => {
    const catalog = listEchoes()
    const costs = [4, 3, 3, 1, 1] as const
    const candidates = catalog.flatMap((mainEcho) => mainEcho.cost === 4 && mainEcho.sets.length > 1
      ? mainEcho.sets.filter((setId) => (
        ECHO_SET_DEFS.some((set) => set.id === setId && set.setMax === 5) &&
        catalog.filter((echo) => echo.cost === 3 && echo.sets.includes(setId)).length >= 2 &&
        catalog.filter((echo) => echo.cost === 1 && echo.sets.includes(setId)).length >= 2
      )).map((setId) => ({ mainEchoId: mainEcho.id, setId }))
      : [])

    expect(candidates.length).toBeGreaterThan(0)
    for (const { mainEchoId, setId } of candidates) {
      const setPreferences = [{ setId, count: 5 }]
      expect(canMainEchoFitSetPlan(mainEchoId, setPreferences, costs), `${mainEchoId}:${setId}`).toBe(true)

      const echoes = generateQuickBuild({ ...makeQuickConfig(), mainEchoId, setPreferences })
      expect(echoes[0]?.id).toBe(mainEchoId)
      expect(echoes.map((echo) => echo && getEchoById(echo.id)?.cost)).toEqual(costs)
      expect(cmptSetCnts(echoes)[setId]).toBe(5)
      for (const echo of echoes) {
        expect(echo?.set).toBe(setId)
        expect(echo && getEchoById(echo.id)?.sets).toContain(setId)
      }
    }
  })
})
