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
it('selects a live rotation from another scenario', () => {
    const settings = selectSuggestionTarget(
      { rotationMode: false, targetFeatureId: 'damage:1308001' },
      'scenario:legacy:1511',
    )
    expect(settings).toMatchObject({
      rotationMode: true,
      rotationSourceId: 'scenario:legacy:1511',
      targetFeatureId: 'damage:1308001',
    })
    expect(suggestionTargetValue(settings)).toBe('scenario:legacy:1511')
  })

it('scores the preset after clearing the live rotation and preserves runtime data', () => {
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

  it('clears the previous resonator target mode for a new default', () => {
    expect(preserveToggles()).toEqual({})
    const retained = preserveToggles({ ...makeOptSets(), searchMode: 'theory', enableGpu: false })
    expect(retained.searchMode).toBe('theory')
    expect(retained.enableGpu).toBe(false)
    expect(retained).not.toHaveProperty('rotationMode')
    expect(retained).not.toHaveProperty('targetMode')
  })

it('selects live and saved rotations while preserving the direct target', () => {
    const base = { rotationMode: false, targetFeatureId: 'damage:1208011' }
    const live = selectSuggestionTarget(base, 'live')
    expect(live).toMatchObject({
      rotationMode: true, rotationSourceId: 'live', targetFeatureId: base.targetFeatureId,
    })
    const saved = selectSuggestionTarget(live, 'saved:one')
    expect(suggestionTargetValue(saved)).toBe('saved:one')
    expect(selectSuggestionTarget(saved, base.targetFeatureId)).toMatchObject({
      rotationMode: false, targetFeatureId: base.targetFeatureId, rotationSourceId: 'saved:one',
    })
    const seed = getResSeedBy('1208')!
    const runtime = mkMaxResRt(seed)
    const simulation = runResSmlt(runtime, seed, makeEnemy(), makeRuntimeMap(runtime), {})
    expect(targetOpts(runtime.id, simulation, {}, [
      { id: 'default:1208', label: 'Default Rotation' },
      { id: 'live', label: 'Live Rotation' },
      { id: 'saved:one', label: 'Saved One' },
    ]).slice(0, 3).map((entry) => entry.value)).toEqual([
      DEFAULT_ROTATION_TARGET, 'live', 'saved:one',
    ])
  })
})
