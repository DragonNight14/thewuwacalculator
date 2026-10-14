/*
  Author: Runor Ewhro
  description: defines the team-first combat scenario. every member has the
               same state shape; team, target, shared combat state, routing,
               and program state live above individual members.
*/

import type { EnemyProfile } from './appState'
import type { ManualBuffs } from './manualBuffs'
import type { OptInventorySelection } from './profile'
import type { SntSetConds } from './sonataSetConditionals'
import type { AttributeKey } from './stats'
import { resolveUnisonBoon } from '@/domain/gameData/unisonBoon'
import type {
  CombatState,
  EchoInstance,
  ResBaseStt,
  ResSeed,
  ResonatorId,
  RotationState,
  WeaponState,
} from './runtime'

declare const combatScenarioIdBrand: unique symbol
declare const teamMemberIdBrand: unique symbol

export type CombatScenarioId = string & {
  readonly [combatScenarioIdBrand]: 'CombatScenarioId'
}

/** stable identity of one member instance inside a scenario. */
export type TeamMemberId = string & {
  readonly [teamMemberIdBrand]: 'TeamMemberId'
}

export function combatScenarioId(value: string): CombatScenarioId {
  return value as CombatScenarioId
}

export function teamMemberId(value: string): TeamMemberId {
  return value as TeamMemberId
}

export interface ScenarioMemberLocalState {
  controls: Record<string, boolean | number | string>
  setConditionals: SntSetConds
  optimizerInventory: OptInventorySelection
}

export interface ScenarioTeamMember {
  id: TeamMemberId
  resonatorId: ResonatorId
  progression: ResBaseStt
  loadout: {
    weapon: WeaponState
    echoes: Array<EchoInstance | null>
  }
  local: ScenarioMemberLocalState
}

export type ScenarioTeamMembers =
  | readonly [ScenarioTeamMember]
  | readonly [ScenarioTeamMember, ScenarioTeamMember]
  | readonly [ScenarioTeamMember, ScenarioTeamMember, ScenarioTeamMember]

export interface ScenarioTeam {
  members: ScenarioTeamMembers
}

export interface ScenarioTargetRouting {
  bySourceMemberId: Readonly<
    Record<TeamMemberId, Readonly<Record<string, TeamMemberId | null>>>
  >
}

export type EnvironmentMemberSelector =
  | { kind: 'all' }
  | { kind: 'members'; memberIds: readonly TeamMemberId[] }
  | { kind: 'attribute'; attributes: readonly AttributeKey[] }
  | { kind: 'weaponType'; weaponTypes: readonly ResSeed['weaponType'][] }

/** one authored manual source resolved through the same member subscription boundary as game effects. */
export interface EnvironmentManualEffect {
  id: string
  enabled: boolean
  label?: string
  selector: EnvironmentMemberSelector
  excludedMemberIds?: readonly TeamMemberId[]
  buffs: ManualBuffs
}

/** target reductions are separate from attacker ignore stats. */
export interface EnvironmentTargetModifiers {
  defenseReduction: number
  resistanceReduction: Partial<Record<AttributeKey, number>>
  damageTakenAmplification: number
}

export interface CombatEnvironment {
  /** shared encounter state, including negative effects applied to the target. */
  combatState: CombatState
  /** team stack count; maximum and value per stack are derived. */
  teamEffects: { unisonBoon: number }
  manualEffects: readonly EnvironmentManualEffect[]
  targetModifiers: EnvironmentTargetModifiers
  routing: ScenarioTargetRouting
}

export interface DormantScenarioMember {
  member: ScenarioTeamMember
  manualEffect?: Pick<EnvironmentManualEffect, 'enabled' | 'label' | 'buffs'>
}

export interface CombatScenario {
  id: CombatScenarioId
  revision: number
  team: ScenarioTeam
  /** off-team setups retained for rejoining resonators; never projected into combat. */
  dormantMembersByResonatorId?: Record<ResonatorId, DormantScenarioMember>
  /** persisted simulation/editor subject; never an implicit effect destination. */
  contextMemberId: TeamMemberId
  /** the scenario target. EnemyProfile remains the current concrete target kind. */
  target: EnemyProfile
  /** shared effect, routing, and target-state boundary for every team member. */
  environment: CombatEnvironment
  program: RotationState
  /** initial on-field state for execution. ui focus is deliberately separate. */
  initialOnFieldMemberId: TeamMemberId
}

export function makeScenarioTeam(
  members: readonly ScenarioTeamMember[],
): ScenarioTeam {
  if (members.length < 1 || members.length > 3) {
    throw new Error(`A combat scenario requires 1 to 3 members; received ${members.length}`)
  }

  const memberIds = new Set<TeamMemberId>()
  const resonatorIds = new Set<ResonatorId>()
  for (const member of members) {
    if (memberIds.has(member.id)) {
      throw new Error(`Duplicate scenario member id: ${member.id}`)
    }
    if (resonatorIds.has(member.resonatorId)) {
      throw new Error(`Duplicate scenario resonator id: ${member.resonatorId}`)
    }
    memberIds.add(member.id)
    resonatorIds.add(member.resonatorId)
  }

  return {
    members: members as ScenarioTeamMembers,
  }
}

/** temporary ui subject rule: member zero is the member shown by active-based ui. */
export function primaryScenarioMember(scenario: CombatScenario): ScenarioTeamMember {
  return scenario.team.members[0]
}

export function contextScenarioMember(scenario: CombatScenario): ScenarioTeamMember {
  return findScenarioMember(scenario, scenario.contextMemberId) ?? primaryScenarioMember(scenario)
}

export function findScenarioMember(
  scenario: CombatScenario,
  memberId: TeamMemberId,
): ScenarioTeamMember | null {
  return scenario.team.members.find((member) => member.id === memberId) ?? null
}

export function scenarioMemberIndex(
  scenario: CombatScenario,
  memberId: TeamMemberId,
): number {
  return scenario.team.members.findIndex((member) => member.id === memberId)
}

export function scenarioMemberByResonatorId(
  scenario: CombatScenario,
  resonatorId: ResonatorId,
): ScenarioTeamMember | null {
  return scenario.team.members.find((member) => member.resonatorId === resonatorId) ?? null
}

export function reviseCombatScenario(
  scenario: CombatScenario,
  changes: Omit<Partial<CombatScenario>, 'id' | 'revision'>,
): CombatScenario {
  const team = changes.team ?? scenario.team
  const environment = changes.environment ?? scenario.environment
  const storedStacks = environment.teamEffects.unisonBoon
  const stacks = resolveUnisonBoon(team.members, storedStacks).stacks
  return {
    ...scenario,
    ...changes,
    ...(stacks !== storedStacks ? {
      environment: { ...environment, teamEffects: { ...environment.teamEffects, unisonBoon: stacks } },
    } : {}),
    id: scenario.id,
    revision: scenario.revision + 1,
  }
}

export function reviseCombatEnvironment(
  scenario: CombatScenario,
  changes: Partial<CombatEnvironment>,
): CombatScenario {
  return reviseCombatScenario(scenario, {
    environment: {
      ...scenario.environment,
      ...changes,
    },
  })
}

/**
 * clone an authored scenario as a new independent document. member identity is
 * scenario-local, so every reference to a member is remapped with the document.
 */
export function instantiateCombatScenario(
  source: CombatScenario,
  id: CombatScenarioId,
): CombatScenario {
  const cloned = structuredClone(source)
  const memberIds = new Map<TeamMemberId, TeamMemberId>(
    cloned.team.members.map((member, index) => [
      member.id,
      teamMemberId(`${id}:member:${index}`),
    ]),
  )
  const fallbackMemberId = memberIds.values().next().value
  if (!fallbackMemberId) {
    throw new Error('A combat scenario requires at least one member')
  }
  const mapMemberId = (memberId: TeamMemberId): TeamMemberId => (
    memberIds.get(memberId) ?? fallbackMemberId
  )
  const members = cloned.team.members.map((member) => ({
    ...member,
    id: mapMemberId(member.id),
  }))
  const bySourceMemberId = Object.fromEntries(
    Object.entries(cloned.environment.routing.bySourceMemberId).flatMap(([sourceId, routes]) => {
      const nextSourceId = memberIds.get(teamMemberId(sourceId))
      if (!nextSourceId) return []
      return [[nextSourceId, Object.fromEntries(
        Object.entries(routes).map(([routeId, targetId]) => [
          routeId,
          targetId ? memberIds.get(targetId) ?? null : null,
        ]),
      )]]
    }),
  ) as Record<TeamMemberId, Record<string, TeamMemberId | null>>

  for (const member of members) {
    bySourceMemberId[member.id] ??= {}
  }

  return {
    ...cloned,
    id,
    revision: 0,
    team: makeScenarioTeam(members),
    contextMemberId: mapMemberId(cloned.contextMemberId),
    initialOnFieldMemberId: mapMemberId(cloned.initialOnFieldMemberId),
    environment: {
      ...cloned.environment,
      manualEffects: cloned.environment.manualEffects.map((effect) => (
        effect.selector.kind === 'members'
          ? {
            ...effect,
            selector: {
              ...effect.selector,
              memberIds: effect.selector.memberIds.flatMap((memberId) => {
                const nextMemberId = memberIds.get(memberId)
                return nextMemberId ? [nextMemberId] : []
              }),
            },
          }
          : effect
      )),
      routing: { bySourceMemberId },
    },
  }
}
