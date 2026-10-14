/*
  Author: Runor Ewhro
  description: protects the generated contracts for the first unison resonators.
*/

import { describe, expect, it } from 'vitest'
import type { ResDtls } from '@/domain/entities/resonator'
import type { SrcPkg } from '@/domain/gameData/contracts'
import { resolveUnisonBoon, unisonBoonSource } from '@/domain/gameData/unisonBoon'
import { listOwnersFor, listStatesFor } from '@/data/catalog/gameDataService'
import resonatorDetailsRaw from '../../../../public/data/beta/resonators/details.json?raw'
import resonatorSourcesRaw from '../../../../public/data/beta/resonators/sources.json?raw'

const details = JSON.parse(resonatorDetailsRaw) as Record<string, ResDtls>
const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]

function sourceFor(resonatorId: string): SrcPkg {
  const source = sources.find((candidate) => candidate.source.id === resonatorId)
  if (!source) {
    throw new Error(`Missing generated source for Resonator ${resonatorId}`)
  }
  return source
}

function skillIdsByType(resonatorId: string): Record<string, string[]> {
  const grouped: Record<string, string[]> = {}

  for (const skill of sourceFor(resonatorId).skills ?? []) {
    const key = skill.skillType.join('+')
    grouped[key] ??= []
    grouped[key].push(skill.id)
  }

  return grouped
}

describe('Unison Resonator generated contracts', () => {
  it('authors Hsin from the Simplified Chinese duration and preserves her Electro Flare rows', () => {
    const hsin = sourceFor('1311')
    const inherent = details['1311']?.inherentSkills.find((entry) => entry.unlockLevel === 50)
    const skills = new Map(hsin.skills?.map((skill) => [skill.id, skill]))

    expect(inherent?.desc).toContain('30s')
    expect(inherent?.desc).not.toContain('7s')
    expect(details['1311']?.negativeEffectSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'electroFlare' }),
      expect.objectContaining({ type: 'maxAdd', key: 'electroFlare', value: 6 }),
    ]))
    expect(skills.get('1311:heart-of-thunder:five-stack')).toMatchObject({
      multiplier: 1.75,
      archetype: 'electroFlare',
      skillType: ['electroFlare'],
    })
    expect(skills.get('1311:heart-of-thunder:remaining')).toMatchObject({
      multiplier: 0.35,
      archetype: 'electroFlare',
      skillType: ['electroFlare'],
    })
    expect(skills.get('1311:s3:pillars-electro-flare')).toMatchObject({
      multiplier: 15,
      archetype: 'electroFlare',
      skillType: ['electroFlare'],
    })
  })

  it('keeps Hsin intro ATK and Heart of Thunder multiplier effects distinct', () => {
    const effects = new Map((sourceFor('1311').effects ?? []).map((effect) => [effect.id, effect]))
    expect(effects.get('1311:lvl50:unison-intro')?.operations).toEqual([{
      type: 'add_base_stat', stat: 'atk', field: 'percent', value: { type: 'const', value: 50 },
    }])
    expect(effects.get('1311:s1:heart-of-thunder')?.operations).toEqual([{
      type: 'scale_skill_multiplier',
      match: { skillIds: ['1311:heart-of-thunder:remaining'] },
      value: { type: 'const', value: 1.2 },
    }])
  })

  it('authors one shared Unison Boon effect and derives its cap and strength from the team', () => {
    const makeMember = (id: string, level = 90, sequence = 0, mode = 'unison') => ({
      resonatorId: id,
      progression: { level, sequence },
      local: { controls: id === '1311' ? { 'resonator:1311:mode:value': mode } : {} },
    }) as Parameters<typeof resolveUnisonBoon>[0][number]
    const suoming = makeMember('1312')
    const hsin = makeMember('1311')

    expect(unisonBoonSource.effects).toHaveLength(1)
    expect(listStatesFor('teamEffect', 'unisonBoon')).toHaveLength(1)
    expect(unisonBoonSource.effects?.[0]?.ownerKey).toBe('teamEffect:unisonBoon')
    expect(sourceFor('1311').effects?.some((effect) => effect.id.includes('unison-boon'))).toBe(false)
    expect(sourceFor('1312').effects?.some((effect) => effect.id.includes('unison-boon'))).toBe(false)
    for (const id of ['1311', '1312']) {
      expect(listStatesFor('resonator', id).some((state) => state.controlKey.includes('unison_boon'))).toBe(false)
      expect(listOwnersFor('resonator', id).some((owner) => owner.id === 'unison_boon')).toBe(false)
    }
    expect(resolveUnisonBoon([suoming], 4)).toEqual({ stacks: 2, max: 2, perStack: 3 })
    expect(resolveUnisonBoon([suoming, hsin], 4)).toEqual({ stacks: 3, max: 3, perStack: 3 })
    expect(resolveUnisonBoon([suoming, makeMember('1311', 90, 6)], 4)).toEqual({ stacks: 4, max: 4, perStack: 3 })
    expect(resolveUnisonBoon([suoming, makeMember('1311', 1, 0)], 4).max).toBe(2)
    expect(resolveUnisonBoon([suoming, makeMember('1311', 90, 6, 'electro_flare')], 4).max).toBe(2)
    expect(resolveUnisonBoon([makeMember('1312', 90, 6), hsin], 4)).toEqual({ stacks: 3, max: 3, perStack: 4.5 })
  })

  it('classifies every Hsin damage row by the damage types stated in her descriptions', () => {
    expect(skillIdsByType('1311')).toEqual({
      basicAtk: [
        '1311101',
        '1311102',
        '1311103',
        '1311104',
        '1311106',
        '1311108',
        '1311109',
        '1311110',
        '1311111',
        '1311112',
        '1311113',
        '1311115',
        '1311116',
        '1311117',
        '1311118',
        '1311119',
        '1311120',
        '1311121',
        '1311122',
      ],
      heavyAtk: ['1311105', '1311107', '1311114'],
      resonanceSkill: [
        '1311201',
        '1311202',
        '1311203',
        '1311701',
        '1311702',
        '1311703',
        '1311704',
        '1311302',
        '1311603',
        '1311606',
      ],
      electroFlare: [
        '1311:heart-of-thunder:five-stack',
        '1311:heart-of-thunder:remaining',
        '1311:s3:pillars-electro-flare',
        '1311:negative-effect:electro-flare',
      ],
      coord: ['1311303'],
      introSkill: ['1311601', '1311602', '1311604', '1311605'],
      outroSkill: ['1311:outro'],
      tuneRupture: ['1311:tune-break'],
      spectroFrazzle: ['1311:negative-effect:spectro-frazzle'],
      aeroErosion: ['1311:negative-effect:aero-erosion'],
      fusionBurst: ['1311:negative-effect:fusion-burst'],
      glacioChafe: ['1311:negative-effect:glacio-chafe'],
    })
  })

  it('authors Hsin\'s Source Intent Unison loop without overcounting the Answering setup', () => {
    const rotation = sourceFor('1311').rotations?.find((candidate) => candidate.id === 'default')

    expect(rotation?.items.flatMap((item) => (
      item.type === 'feature' ? [[item.featureId, item.multiplier]] : []
    ))).toEqual([
      ['damage:1311603', 1],
      ['damage:1311201', 1],
      ['damage:1311104', 1],
      ['damage:1311702', 1],
      ['damage:1311:outro', 1],
      ['damage:1311303', 21],
      ['damage:1311606', 1],
      ['damage:1311118', 1],
      ['damage:1311119', 1],
      ['damage:1311120', 1],
      ['damage:1311121', 1],
      ['damage:1311704', 1],
      ['damage:1311302', 1],
      ['damage:1311:outro', 1],
    ])
    expect(rotation?.items).not.toContainEqual(expect.objectContaining({
      featureId: 'damage:1311103',
    }))
  })

  it('authors Suoming\'s two-entry Unison loop and all six Thunder Crests', () => {
    const suoming = sourceFor('1312')
    const rotation = suoming.rotations?.find((candidate) => candidate.id === 'default')
    const skills = new Map(suoming.skills?.map((skill) => [skill.id, skill]))

    expect(rotation?.items.flatMap((item) => (
      item.type === 'feature' ? [[item.featureId, item.multiplier]] : []
    ))).toEqual([
      ['damage:1312026', 1],
      ['damage:1312021', 1],
      ['damage:1312025', 6],
      ['damage:1312027', 1],
      ['damage:1312012', 1],
      ['damage:1312006', 1],
      ['damage:1312007', 1],
      ['damage:1312017', 1],
      ['damage:1312018', 1],
    ])
    expect(rotation?.items).not.toContainEqual(expect.objectContaining({
      featureId: 'damage:1312011',
    }))
    expect(['1312026', '1312027', '1312028', '1312029'].map((id) => skills.get(id)?.skillType)).toEqual([
      ['basicAtk'],
      ['basicAtk'],
      ['basicAtk'],
      ['basicAtk'],
    ])
    expect(skills.get('1312025')?.skillType).toEqual(['coord'])
  })

  it('keeps Suoming Seal Master multiplier and Crit. DMG effects distinct', () => {
    const effects = new Map((sourceFor('1312').effects ?? []).map((effect) => [effect.id, effect]))
    expect(effects.get('1312:lvl70:seal-master-multiplier')?.operations).toEqual([expect.objectContaining({
      type: 'add_skill_multiplier', value: { type: 'const', value: 1 },
    })])
    expect(effects.get('1312:lvl70:seal-master-crit-dmg')?.operations).toEqual([{
      type: 'add_top_stat', stat: 'critDmg', value: { type: 'const', value: 100 },
    }])
    expect(effects.get('1312:s6:seal-master-crit-dmg')?.operations).toEqual([{
      type: 'add_top_stat', stat: 'critDmg', value: { type: 'const', value: 200 },
    }])
  })

  it('classifies every Suoming damage row by the damage types stated in her descriptions', () => {
    expect(skillIdsByType('1312')).toEqual({
      basicAtk: [
        '1312001',
        '1312002',
        '1312003',
        '1312004',
        '1312005',
        '1312006',
        '1312007',
        '1312008',
        '1312009',
        '1312010',
        '1312011',
        '1312012',
        '1312016',
        '1312017',
        '1312018',
        '1312019',
        '1312026',
        '1312027',
        '1312028',
        '1312029',
      ],
      resonanceSkill: ['1312013', '1312014'],
      resonanceLiberation: ['1312021'],
      coord: ['1312025'],
      tuneRupture: ['1312:tune-break'],
      spectroFrazzle: ['1312:negative-effect:spectro-frazzle'],
      aeroErosion: ['1312:negative-effect:aero-erosion'],
      fusionBurst: ['1312:negative-effect:fusion-burst'],
      glacioChafe: ['1312:negative-effect:glacio-chafe'],
      electroFlare: ['1312:negative-effect:electro-flare'],
    })
  })

  it('uses the shared stack count for Suoming handoff bonuses', () => {
    const suoming = sourceFor('1312')

    for (const id of ['1312:lvl70:aligned-seals', '1312:outro:resonance-skill', '1312:s2:outro-crit-dmg']) {
      const effect = suoming.effects?.find((entry) => entry.id === id)
      expect(effect?.targetScope).toBe('activeOther')
      expect(JSON.stringify(effect)).toContain('state.teamEffects.unisonBoon')
    }
  })

})
