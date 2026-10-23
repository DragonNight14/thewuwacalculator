/*
  Author: Runor Ewhro
  description: resolves rotation nodes and team setup for damage planning.
*/

import type { CombatScenario } from '@/domain/entities/combatScenario.ts'
import { contextScenarioMember, makeScenarioTeam } from '@/domain/entities/combatScenario.ts'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { getDefaultRotation } from '@/data/catalog/gameDataService.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { orderStoredRotationProgram } from '@/engine/rotation/programOrder.ts'
import { projectScenarioRuntimes } from '@/engine/runtime/scenarioRuntime.ts'
import type { RotationCombatSetup } from '@/engine/pipeline/index.ts'

export interface RotationDamageSourceOption {
  id: string
  label: string
}

export interface ResolvedRotationDamageSource {
  id: string
  items: RotationNode[]
  savedTeamContext?: Pick<CombatScenario, 'team' | 'contextMemberId' | 'environment' | 'initialOnFieldMemberId'>
}

/** main-scenario encounter state used to seed live and default rotations. */
export function rotationCombatSetup(scenario: CombatScenario): RotationCombatSetup {
  return {
    memberIdByResonatorId: Object.fromEntries(
      scenario.team.members.map((member) => [member.resonatorId, member.id]),
    ),
    environmentTargetModifiers: scenario.environment.targetModifiers,
    initialOnFieldResonatorId: scenario.team.members.find(
      (member) => member.id === scenario.initialOnFieldMemberId,
    )?.resonatorId,
  }
}

/** bind a saved program's team state to the current searched member and enemy. */
export function rotationDamageContext(
  source: ResolvedRotationDamageSource | null,
  current: CombatScenario,
  runtime: ResRuntime,
): {
  runtime: ResRuntime
  runtimesById: Record<string, ResRuntime>
  selectedTargets: Record<string, string | null>
  combatSetup: RotationCombatSetup
} | null {
  const saved = source?.savedTeamContext
  if (!saved) return null
  const subject = current.team.members.find((member) => member.resonatorId === runtime.id)
    ?? contextScenarioMember(current)
  const members = saved.team.members.map((member) => member.id === saved.contextMemberId
    ? { ...member, progression: subject.progression, loadout: subject.loadout, local: subject.local }
    : member)
  const hybrid: CombatScenario = {
    ...current,
    team: makeScenarioTeam(members),
    contextMemberId: saved.contextMemberId,
    environment: saved.environment,
    initialOnFieldMemberId: saved.initialOnFieldMemberId,
  }
  const projection = projectScenarioRuntimes(hybrid)
  const projected = projection.subjectRuntime
  const boundRuntime: ResRuntime = {
    ...runtime,
    build: { ...runtime.build, team: projected.build.team },
    state: {
      ...runtime.state,
      manualBuffs: projected.state.manualBuffs,
      combat: projected.state.combat,
      teamEffects: projected.state.teamEffects,
    },
    teamRuntimes: projected.teamRuntimes,
  }
  return {
    runtime: boundRuntime,
    runtimesById: { ...projection.runtimesById, [runtime.id]: boundRuntime },
    selectedTargets: projection.selectedTargets,
    combatSetup: rotationCombatSetup(hybrid),
  }
}

export function listRotationDamageSources(
  scenario: CombatScenario,
  saved: readonly SavedRotation[],
  searchedResonatorId = contextScenarioMember(scenario).resonatorId,
  otherLiveScenarios: readonly CombatScenario[] = [],
): RotationDamageSourceOption[] {
  const options: RotationDamageSourceOption[] = []
  if (getDefaultRotation(searchedResonatorId)) {
    options.push({ id: `default:${searchedResonatorId}`, label: 'Default Rotation' })
  }
  if (
    scenario.program.program.length > 0
    && scenario.team.members.some((member) => member.resonatorId === searchedResonatorId)
  ) {
    options.push({ id: 'live', label: 'Live Rotation' })
  }
  const liveScenarios = new Map<string, CombatScenario>()
  for (const live of otherLiveScenarios) {
    if (live.id !== scenario.id && live.program.program.length > 0) {
      liveScenarios.set(live.id, live)
    }
  }
  for (const live of liveScenarios.values()) {
    if (!live.team.members.some((member) => member.resonatorId === searchedResonatorId)) continue
    const ownerId = contextScenarioMember(live).resonatorId
    const name = getResSeedBy(ownerId)?.name ?? ownerId
    options.push({
      id: `scenario:${live.id}`,
      label: `${name} · Live Rotation`,
    })
  }
  for (const entry of saved) {
    const ownerId = contextScenarioMember(entry.scenario).resonatorId
    const searchedMember = entry.scenario.team.members.find(
      (member) => member.resonatorId === searchedResonatorId,
    )
    if (
      entry.scenario.program.program.length > 0
      && searchedMember
    ) {
      const name = getResSeedBy(ownerId)?.name ?? ownerId
      options.push({
        id: `saved:${entry.id}`,
        label: ownerId === searchedResonatorId ? entry.name : `${name} · ${entry.name}`,
      })
    }
  }
  return options
}

export function resolveRotationDamageSource(
  requestedId: string | null | undefined,
  scenario: CombatScenario,
  saved: readonly SavedRotation[],
  searchedResonatorId = contextScenarioMember(scenario).resonatorId,
  otherLiveScenarios: readonly CombatScenario[] = [],
): ResolvedRotationDamageSource | null {
  const options = listRotationDamageSources(scenario, saved, searchedResonatorId, otherLiveScenarios)
  const fallbackId = options[0]?.id ?? null
  const id = requestedId && options.some((entry) => entry.id === requestedId)
    ? requestedId
    : fallbackId
  if (!id) return null
  if (id.startsWith('saved:')) {
    const entry = saved.find((candidate) => `saved:${candidate.id}` === id)
    return entry ? {
      id,
      items: orderStoredRotationProgram(entry.scenario.program.program),
      savedTeamContext: {
        team: entry.scenario.team,
        contextMemberId: entry.scenario.team.members.find(
          (member) => member.resonatorId === searchedResonatorId,
        )?.id ?? entry.scenario.contextMemberId,
        environment: entry.scenario.environment,
        initialOnFieldMemberId: entry.scenario.initialOnFieldMemberId,
      },
    } : null
  }
  if (id.startsWith('scenario:')) {
    const live = otherLiveScenarios.find((candidate) => `scenario:${candidate.id}` === id)
    if (!live) return null
    return {
      id,
      items: orderStoredRotationProgram(live.program.program),
      savedTeamContext: {
        team: live.team,
        contextMemberId: live.team.members.find(
          (member) => member.resonatorId === searchedResonatorId,
        )?.id ?? live.contextMemberId,
        environment: live.environment,
        initialOnFieldMemberId: live.initialOnFieldMemberId,
      },
    }
  }
  if (id === 'live') {
    return {
      id,
      items: orderStoredRotationProgram(scenario.program.program),
      savedTeamContext: {
        team: scenario.team,
        contextMemberId: scenario.team.members.find(
          (member) => member.resonatorId === searchedResonatorId,
        )?.id ?? scenario.contextMemberId,
        environment: scenario.environment,
        initialOnFieldMemberId: scenario.initialOnFieldMemberId,
      },
    }
  }
  const ownerId = id.slice('default:'.length)
  const defaultRotation = getDefaultRotation(ownerId)
  const owner = scenario.team.members.find((member) => member.resonatorId === ownerId)
  if (!defaultRotation) return null
  return {
    id,
    items: defaultRotation.items,
    ...(owner ? { savedTeamContext: {
      team: scenario.team,
      contextMemberId: scenario.team.members.find(
        (member) => member.resonatorId === searchedResonatorId,
      )?.id ?? owner.id,
      environment: scenario.environment,
      initialOnFieldMemberId: scenario.initialOnFieldMemberId,
    } } : {}),
  }
}
