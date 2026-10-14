/*
  Author: Runor Ewhro
  description: applies immutable scenario-member replacement, insertion, and
               removal, maintaining environment routing and member references.
*/

import {
  makeScenarioTeam,
  reviseCombatScenario,
  type CombatScenario,
  type DormantScenarioMember,
  type ScenarioTeamMember,
  type TeamMemberId,
} from '@/domain/entities/combatScenario.ts'
import { makeCustomBuff } from '@/engine/runtime/defaults.ts'
import { makeMemberManualEffect, memberManualEffectId, removeMemberEnvironmentState } from '@/engine/runtime/scenarioEnvironment.ts'

function retainMember(scenario: CombatScenario, member: ScenarioTeamMember): DormantScenarioMember {
  const effect = scenario.environment.manualEffects.find((effect) => effect.id === memberManualEffectId(member.id))
  return structuredClone({
    member,
    ...(effect ? { manualEffect: { enabled: effect.enabled, label: effect.label, buffs: effect.buffs } } : {}),
  })
}

function restoreMember(scenario: CombatScenario, member: ScenarioTeamMember): ScenarioTeamMember {
  const saved = scenario.dormantMembersByResonatorId?.[member.resonatorId]?.member
  // seat identities belong to the current team; saved settings belong to the resonator.
  return structuredClone(saved ? { ...saved, id: member.id } : member)
}

function restoreManualEffect(scenario: CombatScenario, member: ScenarioTeamMember) {
  const saved = scenario.dormantMembersByResonatorId?.[member.resonatorId]?.manualEffect
  const effect = makeMemberManualEffect(member.id, saved?.buffs ?? makeCustomBuff())
  return saved ? { ...effect, enabled: saved.enabled, label: saved.label } : effect
}

export function replaceScenarioTeamMember(
  scenario: CombatScenario,
  memberId: TeamMemberId,
  member: ScenarioTeamMember,
): CombatScenario {
  const index = scenario.team.members.findIndex((candidate) => candidate.id === memberId)
  if (index < 0) return scenario
  const members = [...scenario.team.members]
  const previous = members[index]
  const changedResonator = previous.resonatorId !== member.resonatorId
  const dormantMembersByResonatorId = { ...scenario.dormantMembersByResonatorId }
  if (changedResonator) {
    dormantMembersByResonatorId[previous.resonatorId] = retainMember(scenario, previous)
    delete dormantMembersByResonatorId[member.resonatorId]
  }
  // replacement changes member data, not the seat identity referenced by routing.
  members[index] = {
    ...(changedResonator ? restoreMember(scenario, member) : structuredClone(member)),
    id: memberId,
  }
  try {
    return reviseCombatScenario(scenario, {
      team: makeScenarioTeam(members),
      ...(changedResonator ? {
        dormantMembersByResonatorId,
        environment: {
          ...scenario.environment,
          manualEffects: [
            ...scenario.environment.manualEffects.filter((effect) => effect.id !== memberManualEffectId(memberId)),
            restoreManualEffect(scenario, members[index]),
          ],
        },
      } : {}),
    })
  } catch {
    // reject invalid team revisions without partially updating the scenario.
    return scenario
  }
}

export function insertScenarioTeamMember(
  scenario: CombatScenario,
  index: number,
  member: ScenarioTeamMember,
): CombatScenario {
  if (scenario.team.members.length >= 3) return scenario
  const members = [...scenario.team.members]
  members.splice(Math.max(0, Math.min(index, members.length)), 0, restoreMember(scenario, member))
  const dormantMembersByResonatorId = { ...scenario.dormantMembersByResonatorId }
  delete dormantMembersByResonatorId[member.resonatorId]
  try {
    return reviseCombatScenario(scenario, {
      team: makeScenarioTeam(members),
      dormantMembersByResonatorId,
      // restore only the member's own manual effect, never shared encounter buffs.
      environment: {
        ...scenario.environment,
        manualEffects: [
          ...scenario.environment.manualEffects,
          restoreManualEffect(scenario, member),
        ],
        routing: {
          bySourceMemberId: { ...scenario.environment.routing.bySourceMemberId, [member.id]: {} },
        },
      },
    })
  } catch {
    return scenario
  }
}

export function removeScenarioTeamMember(
  scenario: CombatScenario,
  memberId: TeamMemberId,
): CombatScenario {
  if (scenario.team.members.length === 1) return scenario
  const members = scenario.team.members.filter((member) => member.id !== memberId)
  if (members.length === scenario.team.members.length) return scenario
  const removed = scenario.team.members.find((member) => member.id === memberId)!
  const team = makeScenarioTeam(members)
  const ids = new Set(team.members.map((member) => member.id))
  // remove the departed source and incoming routes to it; null targets remain valid.
  const bySourceMemberId = Object.fromEntries(team.members.map((member) => [
    member.id,
    Object.fromEntries(Object.entries(scenario.environment.routing.bySourceMemberId[member.id] ?? {})
      .filter(([, target]) => target === null || ids.has(target))),
  ]))
  // subject and initial on-field references must resolve to a surviving member.
  return reviseCombatScenario(scenario, {
    team,
    dormantMembersByResonatorId: {
      ...scenario.dormantMembersByResonatorId,
      [removed.resonatorId]: retainMember(scenario, removed),
    },
    contextMemberId: ids.has(scenario.contextMemberId) ? scenario.contextMemberId : team.members[0].id,
    environment: {
      ...removeMemberEnvironmentState(scenario.environment, memberId),
      routing: { bySourceMemberId },
    },
    initialOnFieldMemberId: ids.has(scenario.initialOnFieldMemberId)
      ? scenario.initialOnFieldMemberId
      : team.members[0].id,
  })
}
