/*
  Author: Runor Ewhro
  description: verifies default-rotation suggestion targets remain detached from
               live state and reset target-specific settings between resonators.
*/

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getDefaultRotation } from '@/data/catalog/gameDataService.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { makeEnemy, makeOptSets, mkMaxResRt } from '@/engine/runtime/defaults.ts'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters.ts'
import { runResSmlt } from '@/engine/pipeline'
import { deriveOptSets, preserveToggles } from '@/engine/optimizer/config/defaultSettings.ts'
import { useSuggestionTarget } from '../useSuggestionTarget.ts'
import { DEFAULT_ROTATION_TARGET, selectSuggestionTarget, suggestionTargetValue, targetOpts } from '../helpers.ts'

describe('default rotation targets', () => {
  it('scores the preset after the live rotation is cleared without changing the live runtime or catalog', () => {
    const seed = getResSeedBy('1208')!
    const runtime = mkMaxResRt(seed)
    runtime.rotation.sequence = []
    runtime.rotation.program = []
    const enemy = makeEnemy()
    const participants = makeRuntimeMap(runtime)
    const live = runResSmlt(runtime, seed, enemy, participants, {})
    const preset = structuredClone(getDefaultRotation(runtime.id)!)
    const settings = selectSuggestionTarget({ rotationMode: false, targetFeatureId: null }, DEFAULT_ROTATION_TARGET)
    function Probe() {
      const result = useSuggestionTarget(runtime, live, settings, enemy, participants, {})
      expect(result.runtime.rotation.sequence).toEqual(preset.items)
      expect(result.simulation!.rotation.sequence.entries.length).toBeGreaterThan(0)
      const expectedRuntime = mkMaxResRt(seed)
      const expected = runResSmlt(expectedRuntime, seed, enemy, makeRuntimeMap(expectedRuntime), {})
      expect(result.simulation!.rotation.sequence).toEqual(expected.rotation.sequence)
      expect(result.simulation!.rotation.sequence.entries.some((entry) => entry.avg > 0)).toBe(true)
      expect(result.runtime.rotation.sequence[0]).not.toBe(getDefaultRotation(runtime.id)!.items[0])
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    expect(runtime.rotation.sequence).toEqual([])
    expect(getDefaultRotation(runtime.id)).toEqual(preset)
    expect(suggestionTargetValue({ rotationMode: true, targetFeatureId: null })).toBe(DEFAULT_ROTATION_TARGET)
  })

  it.each(['1208', '1405', '1106', '1303'])('derives the preset or existing skill fallback for %s', (id) => {
    const seed = getResSeedBy(id)!
    const runtime = mkMaxResRt(seed)
    const enemy = makeEnemy()
    const simulation = runResSmlt(runtime, seed, enemy, makeRuntimeMap(runtime), {})
    const options = targetOpts(id, simulation)
    const settings = deriveOptSets({ runtime, enemy })
    const hasDefault = id === '1208'
    expect(options[0].value === DEFAULT_ROTATION_TARGET).toBe(hasDefault)
    expect(settings.rotationMode).toBe(hasDefault)
    expect(settings.targetComboSourceId).toBe(hasDefault ? `default:${id}` : null)
    expect(settings.targetSkillId).toBeTruthy()
    expect(targetOpts(id, null)).toEqual([])
  })

  it('does not carry the previous resonator target mode over a new default', () => {
    expect(preserveToggles()).toEqual({})
    const retained = preserveToggles({ ...makeOptSets(), searchMode: 'theory', enableGpu: false })
    expect(retained.searchMode).toBe('theory')
    expect(retained.enableGpu).toBe(false)
    expect(retained).not.toHaveProperty('rotationMode')
    expect(retained).not.toHaveProperty('targetMode')
  })
})
