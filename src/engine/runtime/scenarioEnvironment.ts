/*
  Author: Runor Ewhro
  description: creates combat environments and resolves authored manual
               effects against equal scenario-member subscriptions.
*/

import type {
  CombatEnvironment,
  EnvironmentManualEffect,
  EnvironmentMemberSelector,
  EnvironmentTargetModifiers,
  ScenarioTeamMember,
  TeamMemberId,
} from '@/domain/entities/combatScenario'
import type { ManualBuffs } from '@/domain/entities/manualBuffs'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { cloneBuffs } from '@/engine/runtime/runtimeCloning'
import type { UnifiedBuffPool } from '@/domain/entities/stats'
import { mergeModBuff } from '@/engine/resolvers/buffPool'

export function makeEmptyManualBuffs(): ManualBuffs {
  return {
    quick: {
      atk: { flat: 0, percent: 0 },
      hp: { flat: 0, percent: 0 },
      def: { flat: 0, percent: 0 },
      critRate: 0,
      critDmg: 0,
      energyRegen: 0,
      healingBonus: 0,
    },
    modifiers: [],
  }
}

export function memberManualEffectId(memberId: TeamMemberId): string {
  return `member:${memberId}:manual`
}

export function makeMemberManualEffect(
  memberId: TeamMemberId,
  buffs: ManualBuffs,
): EnvironmentManualEffect {
  return {
    id: memberManualEffectId(memberId),
    enabled: true,
    selector: { kind: 'members', memberIds: [memberId] },
    buffs: cloneBuffs(buffs),
  }
}

export function makeCombatEnvironment(
  combatState: CombatEnvironment['combatState'],
  routing: CombatEnvironment['routing'],
  manualEffects: readonly EnvironmentManualEffect[] = [],
): CombatEnvironment {
  return {
    combatState: { ...combatState },
    teamEffects: { unisonBoon: 0 },
    manualEffects: manualEffects.map((effect) => ({
      ...effect,
      selector: structuredClone(effect.selector),
      ...(effect.excludedMemberIds
        ? { excludedMemberIds: [...effect.excludedMemberIds] }
        : {}),
      buffs: cloneBuffs(effect.buffs),
    })),
    targetModifiers: {
      defenseReduction: 0,
      resistanceReduction: {},
      damageTakenAmplification: 0,
    },
    routing,
  }
}

export function environmentSelectorMatches(
  selector: EnvironmentMemberSelector,
  member: ScenarioTeamMember,
): boolean {
  if (selector.kind === 'all') return true
  if (selector.kind === 'members') return selector.memberIds.includes(member.id)

  const seed = getResSeedBy(member.resonatorId)
  if (!seed) return false
  if (selector.kind === 'attribute') return selector.attributes.includes(seed.attribute)
  return selector.weaponTypes.includes(seed.weaponType)
}

export function environmentManualEffectMatches(
  effect: EnvironmentManualEffect,
  member: ScenarioTeamMember,
): boolean {
  return !effect.excludedMemberIds?.includes(member.id)
    && environmentSelectorMatches(effect.selector, member)
}

function mergeManualBuffs(target: ManualBuffs, source: ManualBuffs): void {
  target.quick.atk.flat += source.quick.atk.flat
  target.quick.atk.percent += source.quick.atk.percent
  target.quick.hp.flat += source.quick.hp.flat
  target.quick.hp.percent += source.quick.hp.percent
  target.quick.def.flat += source.quick.def.flat
  target.quick.def.percent += source.quick.def.percent
  target.quick.critRate += source.quick.critRate
  target.quick.critDmg += source.quick.critDmg
  target.quick.energyRegen += source.quick.energyRegen
  target.quick.healingBonus += source.quick.healingBonus
  target.modifiers.push(...source.modifiers.map((modifier) => ({ ...modifier })))
}

export function resolveEnvironmentManualBuffs(
  environment: CombatEnvironment,
  member: ScenarioTeamMember,
  excludedEffectIds: ReadonlySet<string> = new Set(),
): ManualBuffs {
  const resolved = makeEmptyManualBuffs()
  for (const effect of environment.manualEffects) {
    if (!excludedEffectIds.has(effect.id)
      && effect.enabled
      && environmentManualEffectMatches(effect, member)) {
      mergeManualBuffs(resolved, effect.buffs)
    }
  }

  return resolved
}

/** apply encounter target modifiers separately from attacker buffs. */
export function applyEnvironmentTargetModifiers(
  pool: UnifiedBuffPool,
  modifiers: EnvironmentTargetModifiers,
): void {
  pool.defShred += modifiers.defenseReduction
  pool.dmgVuln += modifiers.damageTakenAmplification
  for (const [attribute, value] of Object.entries(modifiers.resistanceReduction)) {
    if (!value) continue
    mergeModBuff(pool.attribute[attribute as keyof typeof pool.attribute], {
      resShred: value,
      dmgBonus: 0,
      amplify: 0,
      defIgnore: 0,
    })
  }
}

function subtractQuickBuffs(target: ManualBuffs, contribution: ManualBuffs): void {
  target.quick.atk.flat -= contribution.quick.atk.flat
  target.quick.atk.percent -= contribution.quick.atk.percent
  target.quick.hp.flat -= contribution.quick.hp.flat
  target.quick.hp.percent -= contribution.quick.hp.percent
  target.quick.def.flat -= contribution.quick.def.flat
  target.quick.def.percent -= contribution.quick.def.percent
  target.quick.critRate -= contribution.quick.critRate
  target.quick.critDmg -= contribution.quick.critDmg
  target.quick.energyRegen -= contribution.quick.energyRegen
  target.quick.healingBonus -= contribution.quick.healingBonus
}

/** reverse the aggregate ui projection back into one member-authored source. */
export function extractMemberManualBuffs(
  environment: CombatEnvironment,
  member: ScenarioTeamMember,
  projected: ManualBuffs,
): ManualBuffs {
  const memberEffectId = memberManualEffectId(member.id)
  const other = resolveEnvironmentManualBuffs(
    environment,
    member,
    new Set([memberEffectId]),
  )
  const authored = cloneBuffs(projected)
  subtractQuickBuffs(authored, other)

  for (const contribution of other.modifiers) {
    let index = authored.modifiers.findIndex(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(contribution),
    )
    if (index >= 0) {
      authored.modifiers.splice(index, 1)
      continue
    }

    // if the old ui edited the projected value, retain only its delta from
    // the environment source so the next aggregate projection reproduces the
    // value the user saw while applying the shared contribution once.
    index = authored.modifiers.findIndex((candidate) => (
      candidate.id === contribution.id && candidate.scope === contribution.scope
    ))
    if (index < 0) continue
    const candidate = authored.modifiers[index]
    const value = candidate.value - contribution.value
    if (value === 0) authored.modifiers.splice(index, 1)
    else authored.modifiers[index] = { ...candidate, value }
  }
  return authored
}

export function replaceMemberManualEffect(
  environment: CombatEnvironment,
  memberId: TeamMemberId,
  buffs: ManualBuffs,
): CombatEnvironment {
  const id = memberManualEffectId(memberId)
  const effect = makeMemberManualEffect(memberId, buffs)
  const index = environment.manualEffects.findIndex((candidate) => candidate.id === id)
  const manualEffects = [...environment.manualEffects]
  if (index >= 0) manualEffects[index] = effect
  else manualEffects.push(effect)
  return { ...environment, manualEffects }
}

/** detach edited inherited buffs for one member, then store the desired projection. */
export function replaceProjectedMemberManualBuffs(
  environment: CombatEnvironment,
  member: ScenarioTeamMember,
  projected: ManualBuffs,
): CombatEnvironment {
  const ownEffectId = memberManualEffectId(member.id)
  const projectedById = new Map(projected.modifiers.map((modifier) => [modifier.id, modifier]))
  const previous = resolveEnvironmentManualBuffs(environment, member)
  const quickChanged = (contribution: ManualBuffs['quick']): boolean => (
    (contribution.atk.flat !== 0 && previous.quick.atk.flat !== projected.quick.atk.flat)
    || (contribution.atk.percent !== 0 && previous.quick.atk.percent !== projected.quick.atk.percent)
    || (contribution.hp.flat !== 0 && previous.quick.hp.flat !== projected.quick.hp.flat)
    || (contribution.hp.percent !== 0 && previous.quick.hp.percent !== projected.quick.hp.percent)
    || (contribution.def.flat !== 0 && previous.quick.def.flat !== projected.quick.def.flat)
    || (contribution.def.percent !== 0 && previous.quick.def.percent !== projected.quick.def.percent)
    || (contribution.critRate !== 0 && previous.quick.critRate !== projected.quick.critRate)
    || (contribution.critDmg !== 0 && previous.quick.critDmg !== projected.quick.critDmg)
    || (contribution.energyRegen !== 0 && previous.quick.energyRegen !== projected.quick.energyRegen)
    || (contribution.healingBonus !== 0 && previous.quick.healingBonus !== projected.quick.healingBonus)
  )
  let changed = false
  const manualEffects = environment.manualEffects.map((effect) => {
    if (effect.id === ownEffectId || !effect.enabled || !environmentManualEffectMatches(effect, member)) {
      return effect
    }

    const modifierChanged = effect.buffs.modifiers.some((modifier) => {
      const edited = projectedById.get(modifier.id)
      return !edited || JSON.stringify(edited) !== JSON.stringify(modifier)
    })
    if (!modifierChanged && !quickChanged(effect.buffs.quick)) return effect
    changed = true
    return {
      ...effect,
      excludedMemberIds: [...(effect.excludedMemberIds ?? []), member.id],
    }
  })
  const revised = changed ? { ...environment, manualEffects } : environment
  return replaceMemberManualEffect(
    revised,
    member.id,
    extractMemberManualBuffs(revised, member, projected),
  )
}

export function removeMemberEnvironmentState(
  environment: CombatEnvironment,
  memberId: TeamMemberId,
): CombatEnvironment {
  const manualEffects = environment.manualEffects
    .map((effect): EnvironmentManualEffect | null => {
      if (effect.id === memberManualEffectId(memberId)) return null
      if (effect.selector.kind !== 'members') return effect
      const memberIds = effect.selector.memberIds.filter((id) => id !== memberId)
      return memberIds.length > 0
        ? { ...effect, selector: { ...effect.selector, memberIds } }
        : null
    })
    .filter((effect): effect is EnvironmentManualEffect => Boolean(effect))

  const bySourceMemberId = { ...environment.routing.bySourceMemberId }
  delete bySourceMemberId[memberId]
  const routing = {
    bySourceMemberId: Object.fromEntries(Object.entries(bySourceMemberId).map(([sourceId, routes]) => [
      sourceId,
      Object.fromEntries(Object.entries(routes).filter(([, targetId]) => targetId !== memberId)),
    ])),
  } as CombatEnvironment['routing']

  return { ...environment, manualEffects, routing }
}
