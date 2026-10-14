/*
  Author: Runor Ewhro
  description: builds and queries the game data registry used to organize
               sources, owners, states, effects, skills, features, and rotations.
*/

import type {
  CondDef,
  DataSrcRef,
  EffectDef,
  EffectBuckets,
  FeatDef,
  GameDataReg,
  RotDef,
  SrcOwnDef,
  SrcPkg,
  SourceState,
} from '@/domain/gameData/contracts'
import type { SkillDamageEntry, SkillDef } from '@/domain/entities/stats'
import { unisonBoonSource } from '@/domain/gameData/unisonBoon'

const NO_OWNERS: SrcOwnDef[] = []
const NO_EFFECTS: EffectDef[] = []
const NO_EFFECT_SETS: EffectBuckets = {
  all: NO_EFFECTS,
  runtime: NO_EFFECTS,
  runtimePreStats: NO_EFFECTS,
  runtimePostStats: NO_EFFECTS,
  runtimeFinalStats: NO_EFFECTS,
  skill: NO_EFFECTS,
}
const NO_STATES: SourceState[] = []
const NO_CONDS: CondDef[] = []
const NO_FEATS: FeatDef[] = []
const NO_ROTS: RotDef[] = []
const NO_SKILLS: SkillDef[] = []
const NO_DAMAGE_ENTRIES: SkillDamageEntry[] = []

// create a stable registry key for a source
export function makeSourceKey(source: DataSrcRef): string {
  return `${source.type}:${source.id}`
}

// build the full game data registry from source packages
export function mkGameDataRe(
  sources: SrcPkg[],
  options: { resonatorStatesById?: Record<string, SourceState[]>; base?: GameDataReg } = {},
): GameDataReg {
  const allSources = options.base?.sourcesByKey['teamEffect:unisonBoon']
    || sources.some((source) => source.source.type === 'teamEffect' && source.source.id === 'unisonBoon')
    ? sources : [...sources, unisonBoonSource]
  const resonatorStatesById = options.resonatorStatesById ?? {}
  const base = options.base
  const sourcesByKey: Record<string, SrcPkg> = { ...base?.sourcesByKey }
  const wnrsBySrcKey: Record<string, SrcOwnDef[]> = { ...base?.ownersBySourceKey }
  const ownersByKey: Record<string, SrcOwnDef> = { ...base?.ownersByKey }
  const ffctBySrcKey: Record<string, EffectDef[]> = { ...base?.effectsBySourceKey }
  const ffctBktsBySr: Record<string, EffectBuckets> = { ...base?.effectBucketsBySourceKey }
  const ffctByOwnKey: Record<string, EffectDef[]> = { ...base?.effectsByOwnerKey }
  const sttsBySrcKey: Record<string, SourceState[]> = { ...base?.statesBySourceKey }
  const sttsByOwnKey: Record<string, SourceState[]> = { ...base?.statesByOwnerKey }
  const sttsByCntrKe: Record<string, SourceState> = { ...base?.statesByControlKey }
  const condsBySrcKe: Record<string, CondDef[]> = { ...base?.conditionsBySourceKey }
  const condsByOwnKe: Record<string, CondDef[]> = { ...base?.conditionsByOwnerKey }
  const featsBySrcKe: Record<string, FeatDef[]> = { ...base?.featuresBySourceKey }
  const rttnBySrcKey: Record<string, RotDef[]> = { ...base?.rotationsBySourceKey }
  const skllBySrcKey: Record<string, SkillDef[]> = { ...base?.skillsBySourceKey }
  const dmgEntBySrcK: Record<string, SkillDamageEntry[]> = { ...base?.damageEntriesBySourceKey }
  const dmgEntByKey: Record<string, SkillDamageEntry> = { ...base?.damageEntriesByKey }
  const resSkllById: Record<string, SkillDef[]> = { ...base?.resonatorSkillsById }
  const resDmgEntById: Record<string, SkillDamageEntry[]> = { ...base?.resonatorDamageEntriesById }
  const resFeatsById: Record<string, FeatDef[]> = { ...base?.resonatorFeaturesById }
  const resRttnById: Record<string, RotDef[]> = { ...base?.resonatorRotationsById }

  for (const source of allSources) {
    const key = makeSourceKey(source.source)

    if (sourcesByKey[key]) {
      throw new Error(`duplicate game-data source: ${key}`)
    }

    const damageEntries = source.damageEntries ?? NO_DAMAGE_ENTRIES
    const damageEntriesBySkillId = new Map<string, SkillDamageEntry[]>()
    for (const entry of damageEntries) {
      const entryKey = `${entry.resonatorId}:${entry.id}`
      if (dmgEntByKey[entryKey]) {
        throw new Error(`duplicate damage entry key: ${entryKey}`)
      }
      dmgEntByKey[entryKey] = entry

      if (!entry.skillId) {
        continue
      }
      const entries = damageEntriesBySkillId.get(entry.skillId) ?? []
      entries.push(entry)
      damageEntriesBySkillId.set(entry.skillId, entries)
    }

    const skills = (source.skills ?? NO_SKILLS).map((skill) => {
      const entries = damageEntriesBySkillId.get(skill.id)
      return entries?.length ? { ...skill, damageEntries: entries } : skill
    })
    const normalizedSource = skills === source.skills && damageEntries === source.damageEntries
      ? source
      : { ...source, skills, damageEntries }

    sourcesByKey[key] = normalizedSource
    wnrsBySrcKey[key] = source.owners ?? NO_OWNERS
    const effects = source.effects ?? NO_EFFECTS
    const rtPreStts: EffectDef[] = []
    const rtPostStts: EffectDef[] = []
    const rtFinalStts: EffectDef[] = []
    const runtime: EffectDef[] = []
    const skill: EffectDef[] = []

    for (const effect of effects) {
      const hasSkillOp = effect.operations.some((op) =>
          op.type === 'add_skill_mod' ||
          op.type === 'add_skill_multiplier' ||
          op.type === 'add_skill_hit_multiplier' ||
          op.type === 'add_skill_scalar' ||
          op.type === 'scale_skill_multiplier',
      )

      if (effect.trigger === 'skill' || hasSkillOp) {
        skill.push(effect)
      }

      if (effect.trigger === 'runtime') {
        runtime.push(effect)

        if (effect.stage === 'finalStats') {
          rtFinalStts.push(effect)
        } else if (effect.stage === 'postStats') {
          rtPostStts.push(effect)
        } else {
          rtPreStts.push(effect)
        }
      }
    }

    ffctBySrcKey[key] = effects
    ffctBktsBySr[key] = {
      all: effects,
      runtime,
      runtimePreStats: rtPreStts,
      runtimePostStats: rtPostStts,
      runtimeFinalStats: rtFinalStts,
      skill,
    }
    const states = source.states?.length
      ? source.states
      : source.source.type === 'resonator'
        ? resonatorStatesById[source.source.id] ?? NO_STATES
        : NO_STATES

    sttsBySrcKey[key] = states
    condsBySrcKe[key] = source.conditions ?? NO_CONDS
    featsBySrcKe[key] = source.features ?? NO_FEATS
    rttnBySrcKey[key] = source.rotations ?? NO_ROTS
    skllBySrcKey[key] = skills
    dmgEntBySrcK[key] = damageEntries

    if (source.source.type === 'resonator') {
      resSkllById[source.source.id] = skills
      resDmgEntById[source.source.id] = damageEntries
      resFeatsById[source.source.id] = source.features ?? NO_FEATS
      resRttnById[source.source.id] = source.rotations ?? NO_ROTS
    }
  }

  for (const source of allSources) {
    for (const owner of source.owners ?? []) {
      if (ownersByKey[owner.ownerKey]) {
        throw new Error(`duplicate source owner key: ${owner.ownerKey}`)
      }

      ownersByKey[owner.ownerKey] = owner
    }
  }

  for (const source of allSources) {
    const states = source.states?.length
      ? source.states
      : source.source.type === 'resonator'
        ? resonatorStatesById[source.source.id] ?? NO_STATES
        : NO_STATES

    for (const state of states) {
      if (!ownersByKey[state.ownerKey]) {
        throw new Error(`unknown state owner key: ${state.ownerKey}`)
      }

      if (sttsByCntrKe[state.controlKey]) {
        throw new Error(`duplicate state control key: ${state.controlKey}`)
      }

      sttsByCntrKe[state.controlKey] = state
      const entries = sttsByOwnKey[state.ownerKey]
      if (entries && entries === base?.statesByOwnerKey[state.ownerKey]) sttsByOwnKey[state.ownerKey] = [...entries]
      ;(sttsByOwnKey[state.ownerKey] ??= []).push(state)
    }

    for (const condition of source.conditions ?? []) {
      if (!condition.ownerKey) {
        continue
      }

      if (!ownersByKey[condition.ownerKey]) {
        throw new Error(`unknown condition owner key: ${condition.ownerKey}`)
      }

      const entries = condsByOwnKe[condition.ownerKey]
      if (entries && entries === base?.conditionsByOwnerKey[condition.ownerKey]) condsByOwnKe[condition.ownerKey] = [...entries]
      ;(condsByOwnKe[condition.ownerKey] ??= []).push(condition)
    }

    for (const effect of source.effects ?? []) {
      if (!effect.ownerKey) {
        continue
      }

      if (!ownersByKey[effect.ownerKey]) {
        throw new Error(`unknown effect owner key: ${effect.ownerKey}`)
      }

      const entries = ffctByOwnKey[effect.ownerKey]
      if (entries && entries === base?.effectsByOwnerKey[effect.ownerKey]) ffctByOwnKey[effect.ownerKey] = [...entries]
      ;(ffctByOwnKey[effect.ownerKey] ??= []).push(effect)
    }
  }

  return {
    sourcesByKey,
    ownersBySourceKey: wnrsBySrcKey,
    ownersByKey,
    effectsBySourceKey: ffctBySrcKey,
    effectBucketsBySourceKey: ffctBktsBySr,
    effectsByOwnerKey: ffctByOwnKey,
    statesBySourceKey: sttsBySrcKey,
    statesByOwnerKey: sttsByOwnKey,
    statesByControlKey: sttsByCntrKe,
    conditionsBySourceKey: condsBySrcKe,
    conditionsByOwnerKey: condsByOwnKe,
    featuresBySourceKey: featsBySrcKe,
    rotationsBySourceKey: rttnBySrcKey,
    skillsBySourceKey: skllBySrcKey,
    damageEntriesBySourceKey: dmgEntBySrcK,
    damageEntriesByKey: dmgEntByKey,
    resonatorSkillsById: resSkllById,
    resonatorDamageEntriesById: resDmgEntById,
    resonatorFeaturesById: resFeatsById,
    resonatorRotationsById: resRttnById,
  }
}

// list effects for a source, optionally filtered by trigger
export function listEffects(
    registry: GameDataReg,
    source: DataSrcRef,
    trigger?: EffectDef['trigger'],
): EffectDef[] {
  const effects = registry.effectsBySourceKey[makeSourceKey(source)] ?? NO_EFFECTS

  if (!trigger) {
    return effects
  }

  const buckets = registry.effectBucketsBySourceKey[makeSourceKey(source)] ?? NO_EFFECT_SETS
  return trigger === 'skill' ? buckets.skill : buckets.runtime
}

// list staged runtime effects for a source
export function listSrcRtFfc(
    registry: GameDataReg,
    source: DataSrcRef,
    stage: 'preStats' | 'postStats' | 'finalStats',
): EffectDef[] {
  const buckets = registry.effectBucketsBySourceKey[makeSourceKey(source)] ?? NO_EFFECT_SETS
  if (stage === 'finalStats') return buckets.runtimeFinalStats
  return stage === 'postStats' ? buckets.runtimePostStats : buckets.runtimePreStats
}

// list states for a source
export function listSrcStts(
    registry: GameDataReg,
    source: DataSrcRef,
): SourceState[] {
  return registry.statesBySourceKey[makeSourceKey(source)] ?? NO_STATES
}

// list owners for a source
export function listSrcWnrs(
    registry: GameDataReg,
    source: DataSrcRef,
): SrcOwnDef[] {
  return registry.ownersBySourceKey[makeSourceKey(source)] ?? NO_OWNERS
}

// list conditions for a source
export function listSrcConds(
    registry: GameDataReg,
    source: DataSrcRef,
): CondDef[] {
  return registry.conditionsBySourceKey[makeSourceKey(source)] ?? NO_CONDS
}

// get a source owner by owner key
export function getSrcOwnByK(
    registry: GameDataReg,
    ownerKey: string,
): SrcOwnDef | null {
  return registry.ownersByKey[ownerKey] ?? null
}

// list effects attached to an owner key
export function listFfctByOw(
    registry: GameDataReg,
    ownerKey: string,
): EffectDef[] {
  return registry.effectsByOwnerKey[ownerKey] ?? NO_EFFECTS
}

// list states attached to an owner key
export function listSttsByOw(
    registry: GameDataReg,
    ownerKey: string,
): SourceState[] {
  return registry.statesByOwnerKey[ownerKey] ?? NO_STATES
}

// get a state definition by its control key
export function getSttByCntr(
    registry: GameDataReg,
    controlKey: string,
): SourceState | null {
  return registry.statesByControlKey[controlKey] ?? null
}

// list conditions attached to an owner key
export function listCondsByO(
    registry: GameDataReg,
    ownerKey: string,
): CondDef[] {
  return registry.conditionsByOwnerKey[ownerKey] ?? NO_CONDS
}

// get all resonator skills by resonator id
export function getResSkll(
    registry: GameDataReg,
    resonatorId: string,
): SkillDef[] {
  return registry.resonatorSkillsById[resonatorId] ?? NO_SKILLS
}

// list all skills for a source
export function listSrcSkll(
    registry: GameDataReg,
    source: DataSrcRef,
): SkillDef[] {
  return registry.skillsBySourceKey[makeSourceKey(source)] ?? NO_SKILLS
}

// list all features for a source
export function listSrcFeats(
    registry: GameDataReg,
    source: DataSrcRef,
): FeatDef[] {
  return registry.featuresBySourceKey[makeSourceKey(source)] ?? NO_FEATS
}

// list all rotations for a source
export function listSrcRttn(
    registry: GameDataReg,
    source: DataSrcRef,
): RotDef[] {
  return registry.rotationsBySourceKey[makeSourceKey(source)] ?? NO_ROTS
}

// get all resonator features by resonator id
export function getResFeats(
    registry: GameDataReg,
    resonatorId: string,
): FeatDef[] {
  return registry.resonatorFeaturesById[resonatorId] ?? NO_FEATS
}

// get all resonator rotations by resonator id
export function getResRttn(
    registry: GameDataReg,
    resonatorId: string,
): RotDef[] {
  return registry.resonatorRotationsById[resonatorId] ?? NO_ROTS
}
