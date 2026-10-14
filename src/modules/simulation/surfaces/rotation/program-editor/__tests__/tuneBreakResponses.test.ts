/*
  Author: Runor Ewhro
  description: verifies team response authoring, persistence, and mode-sensitive
               execution of automatically attached tune rupture responses.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { makeScenarioTeam, type CombatScenario } from '@/domain/entities/combatScenario.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { makeResProfile, makeScenarioFromProfiles } from '@/engine/runtime/defaults.ts'
import { parseCombatScenario } from '@/engine/runtime/schema.ts'
import { prepareCombatScenario, executeCombatScenarioProgram } from '@/engine/pipeline/combatScenario.ts'
import { visibleRotMembers } from '@/modules/simulation/surfaces/rotation/shared/catalog.ts'
import type { RotationMember, SkillMenuEntry } from '@/modules/simulation/surfaces/rotation/shared/authoringTypes.ts'
import { applyFeatureSelection, makeFeatureNode, makePaletteNode } from '../model/nodeAuthoring.ts'
import { editorSectionsToRotation } from '../model/toRotationNodes.ts'
import type { EditorSection, EditorStep } from '../model/program.ts'

const LYNAE_MODE = 'runtime.state.controls.resonator:1509:mode:value'

function team(ids: string[]) {
  const solos = ids.map((id) => {
    const seed = getResSeedBy(id)
    if (!seed) throw new Error(`Missing test resonator ${id}`)
    return makeScenarioFromProfiles({ [id]: makeResProfile(seed, { maxed: true }) }, null, 0, id)
  })
  const scenario = { ...solos[0], team: makeScenarioTeam(solos.map((solo) => solo.team.members[0])) }
  const prepared = prepareCombatScenario(scenario)
  return { scenario, members: visibleRotMembers(prepared.subjectRuntime, prepared.runtimesById) }
}

function entry(member: RotationMember, featureId: string): SkillMenuEntry {
  const feature = member.features.find((candidate) => candidate.id === featureId)
  const skill = member.skills.find((candidate) => candidate.id === feature?.skillId)
  if (!feature || !skill) throw new Error(`Missing test feature ${featureId}`)
  return { feature, skill, featureId, resonatorId: member.id, resName: member.name, featureLabel: feature.label, variant: 'skill' }
}

function breakSpec(member: RotationMember) {
  return { kind: 'step' as const, label: 'Tune Break', featureId: `damage:${member.id}:tune-break`, resonatorId: member.id, tab: 'tuneBreak' }
}

function sections(step: EditorStep): EditorSection[] {
  return [{ id: 'main', title: 'Main', meta: '', children: [step] }]
}

function serialize(step: EditorStep): Extract<RotationNode, { type: 'feature' }> {
  const node = editorSectionsToRotation(sections(step), [])[0].items[0]
  if (node.type !== 'feature') throw new Error('Expected a serialized feature')
  return node
}

function mode(value: string): RotationNode {
  return { id: `mode:${value}`, type: 'condition', resonatorId: '1509', changes: [{ type: 'set', path: LYNAE_MODE, value, resonatorId: '1509' }] }
}

describe('automatic Tune Break response attachments', () => {
  it('adds each teammate response once through both click and drag authoring', () => {
    const { scenario, members } = team(['1210', '1509', '1209'])
    const spec = breakSpec(members[0])
    const clicked = makeFeatureNode(spec, members[0].id, members)
    const dropped = makePaletteNode(spec, members[0].id, [], undefined, undefined, members)
    expect(dropped?.type).toBe('step')
    if (dropped?.type !== 'step') throw new Error('Expected a feature drop')

    for (const step of [clicked, dropped]) {
      const node = serialize(step)
      expect(node.attached?.features.map((child) => [child.resonatorId, child.featureId])).toEqual([
        ['1210', 'damage:1210603'],
        ['1509', 'damage:1509032'],
        ['1209', 'damage:1209031'],
      ])
      expect(node.attached?.features.every((child) => !('label' in child) && !child.attached)).toBe(true)
      scenario.program.program = [node]
      const roundTrip = parseCombatScenario(JSON.parse(JSON.stringify(scenario)))
      expect(roundTrip.success).toBe(true)
      if (!roundTrip.success) throw new Error('Scenario round trip failed')
      expect(roundTrip.data.program.program).toEqual([node])
      const result = executeCombatScenarioProgram(prepareCombatScenario(roundTrip.data as unknown as CombatScenario))
      expect(result?.entries.map((row) => row.feature.id)).toEqual([
        spec.featureId, 'damage:1210603', 'damage:1509032', 'damage:1209031',
      ])
    }
  })

  it('uses explicit trigger metadata, excluding other rupture skills and sub-hits', () => {
    const { members } = team(['1210'])
    const response = members[0].skills.find((skill) => skill.triggeredBy === 'teamTuneBreak')!
    const future: RotationMember = {
      ...members[0], id: 'future-resonator',
      skills: [{ ...response, id: 'future-skill', label: 'Unrelated display name' }],
      features: [{ id: 'future-feature', label: 'Other label', source: { type: 'resonator', id: 'future-resonator' }, skillId: 'future-skill' }],
    }
    const step = makeFeatureNode(breakSpec(members[0]), members[0].id, [...members, future])
    expect(step.attached?.map((child) => child.featureId)).toEqual(['damage:1210603', 'future-feature'])
    expect(makeFeatureNode({ ...breakSpec(members[0]), tab: 'forteCircuit', featureId: 'damage:1210604' }, members[0].id, members).attached).toBeUndefined()
  })

  it('keeps responses editable and avoids duplicates when a feature is replaced', () => {
    const { members } = team(['1506', '1509'])
    const spec = breakSpec(members[0])
    const step = makeFeatureNode(spec, members[0].id, members)
    const response = step.attached![0]
    response.disabled = true
    response.multiplier = 2
    const other = makeFeatureNode({ label: 'Other attachment', featureId: 'damage:1506024', resonatorId: '1506', tab: 'introSkill' }, '1506')
    step.attached!.push(other)
    const replaced = applyFeatureSelection(sections(step), step.id, entry(members[0], spec.featureId), members)[0].children[0] as EditorStep
    expect(replaced.attached).toEqual([response, other])
    const basic = entry(members[0], 'damage:1506016')
    const changed = applyFeatureSelection(sections(replaced), step.id, basic, members)[0].children[0] as EditorStep
    expect(changed.attached).toEqual([other])
    const restored = applyFeatureSelection(sections(changed), step.id, entry(members[0], spec.featureId), members)[0].children[0] as EditorStep
    expect(restored.attached?.map((child) => child.featureId)).toEqual([other.featureId, 'damage:1509032'])
  })

  it('checks Lynae mode at each break, including node-local mode overrides', () => {
    const { scenario, members } = team(['1506', '1509', '1502'])
    const lynae = scenario.team.members.find((member) => member.resonatorId === '1509')!
    lynae.local.controls['resonator:1509:mode:value'] = 'tune_strain'
    const makeBreak = (id: string) => ({ ...serialize(makeFeatureNode(breakSpec(members[0]), '1506', members)), id })
    const first = makeBreak('first')
    const local = makeBreak('local')
    local.attached!.conditions = [mode('tune_rupture') as Extract<RotationNode, { type: 'condition' }>]
    const after = makeBreak('after')
    const last = makeBreak('last')
    last.multiplier = 2
    scenario.program.program = [first, local, after, mode('tune_rupture'), last, { ...makeBreak('disabled'), enabled: false }]
    const result = executeCombatScenarioProgram(prepareCombatScenario(scenario))
    const responses = result?.entries.filter((row) => row.feature.id === 'damage:1509032') ?? []
    expect(responses.map((row) => row.nodeId)).toEqual([
      local.attached!.features[0].id, last.attached!.features[0].id,
    ])
    expect(responses[0].avg).toBeGreaterThan(0)
    expect(responses[1].avg).toBeCloseTo(responses[0].avg * 2)
  })

  it('leaves Tune Break alone when the team has no response skill', () => {
    const { members } = team(['1506', '1502'])
    expect(makeFeatureNode(breakSpec(members[0]), '1506', members).attached).toBeUndefined()
  })

  it('attaches responses to a named Tune Break skill, including the caster response', () => {
    const { members } = team(['1509'])
    const ownBreak = entry(members[0], 'damage:1509026')
    const node = makeFeatureNode({
      label: ownBreak.skill.label,
      featureId: ownBreak.featureId,
      resonatorId: ownBreak.resonatorId,
      tab: ownBreak.skill.tab,
    }, '1509', members)
    expect(node.attached?.map((child) => child.featureId)).toEqual(['damage:1509032'])
  })
})
