/*
  Author: Runor Ewhro
  description: materializes one equal-member runtime projection from the
               canonical combat scenario for legacy calculation consumers.
*/

import type {
  CombatScenario,
  ScenarioTeamMember,
  TeamMemberId,
} from '@/domain/entities/combatScenario'
import { contextScenarioMember, primaryScenarioMember } from '@/domain/entities/combatScenario'
import type { ResRuntime, TeamMemRt, TeamSlots } from '@/domain/entities/runtime'
import type { ResProf } from '@/domain/entities/profile'
import type { ScenarioWorkspace } from '@/domain/entities/scenarioLibrary'
import { cloneEchoLoadout } from '@/domain/entities/inventoryStorage'
import { scopedTargetOwnerKey } from '@/domain/gameData/targetRouting'
import { resolveUnisonBoon } from '@/domain/gameData/unisonBoon'
import {
  cloneCmbtStt,
  cloneResBase,
  cloneRotation,
  cloneWpnMkSt,
} from '@/engine/runtime/runtimeCloning'
import {
  makeEmptyManualBuffs,
  resolveEnvironmentManualBuffs,
} from '@/engine/runtime/scenarioEnvironment'
import { cloneOptInventorySelection } from '@/domain/entities/profile'
import { cloneSntSet } from '@/domain/entities/sonataSetConditionals'
import { normResRtCnt } from '@/engine/gameData/controlOptions'
import { getDefaultRotation } from '@/data/catalog/gameDataService.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'

const defaultRotationByProgram = new WeakMap<CombatScenario['program'], Map<string, ResRuntime['rotation']>>()
const EMPTY_ROTATION: RotationNode[] = []
function projectedRotation(program: CombatScenario['program'], resonatorId: string): ResRuntime['rotation'] {
  let byResonator = defaultRotationByProgram.get(program)
  if (!byResonator) defaultRotationByProgram.set(program, byResonator = new Map())
  const sequence = getDefaultRotation(resonatorId)?.items ?? EMPTY_ROTATION
  const previous = byResonator.get(resonatorId)
  if (previous?.sequence === sequence) return previous
  const rotation = { ...program, sequence }
  byResonator.set(resonatorId, rotation)
  return rotation
}

export function scenarioTeamSlots(scenario: CombatScenario): TeamSlots {
  return [
    scenario.team.members[0]?.resonatorId ?? null,
    scenario.team.members[1]?.resonatorId ?? null,
    scenario.team.members[2]?.resonatorId ?? null,
  ]
}

// projections are read-only views. editing boundaries replace the changed path;
// export/import and draft factories still clone when they need independent data.
const manualByEffects = new WeakMap<CombatScenario['environment']['manualEffects'], Map<string, ReturnType<typeof resolveEnvironmentManualBuffs>>>()
function projectedManualBuffs(scenario: CombatScenario, member: ScenarioTeamMember) {
  const effects = scenario.environment.manualEffects
  let cache = manualByEffects.get(effects)
  if (!cache) manualByEffects.set(effects, cache = new Map())
  const key = `${member.id}:${member.resonatorId}`
  let buffs = cache.get(key)
  if (!buffs) {
    buffs = resolveEnvironmentManualBuffs(scenario.environment, member)
    cache.set(key, buffs)
  }
  return buffs
}

const compactByLoadout = new WeakMap<ScenarioTeamMember['loadout'], TeamMemRt>()
function compactMember(scenario: CombatScenario, member: ScenarioTeamMember): TeamMemRt {
  const manualBuffs = projectedManualBuffs(scenario, member)
  const previous = compactByLoadout.get(member.loadout)
  if (previous?.id === member.resonatorId
    && previous.base.sequence === member.progression.sequence
    && previous.manualBuffs === manualBuffs) return previous
  const compact: TeamMemRt = {
    id: member.resonatorId,
    base: { sequence: member.progression.sequence },
    build: {
      weapon: {
        id: member.loadout.weapon.id,
        rank: member.loadout.weapon.rank,
        baseAtk: member.loadout.weapon.baseAtk,
      },
      echoes: member.loadout.echoes,
    },
    manualBuffs,
  }
  compactByLoadout.set(member.loadout, compact)
  return compact
}

const runtimeByMember = new WeakMap<ScenarioTeamMember, ResRuntime>()
const teamEffectsByScenario = new WeakMap<CombatScenario, NonNullable<ResRuntime['state']['teamEffects']>>()

export function projectScenarioTeamEffects(scenario: CombatScenario): NonNullable<ResRuntime['state']['teamEffects']> {
  const cached = teamEffectsByScenario.get(scenario)
  if (cached) return cached
  const resolved = resolveUnisonBoon(scenario.team.members, scenario.environment.teamEffects.unisonBoon)
  const state = { unisonBoon: resolved.stacks, unisonBoonMax: resolved.max, unisonBoonPerStack: resolved.perStack }
  teamEffectsByScenario.set(scenario, state)
  return state
}

export function projectScenarioMemberRuntime(
  scenario: CombatScenario,
  member: ScenarioTeamMember,
): ResRuntime {
  const previous = runtimeByMember.get(member)
  const manualBuffs = projectedManualBuffs(scenario, member)
  const resolvedTeamEffects = projectScenarioTeamEffects(scenario)
  const teamEffects = previous?.state.teamEffects?.unisonBoon === resolvedTeamEffects.unisonBoon
    && previous.state.teamEffects.unisonBoonMax === resolvedTeamEffects.unisonBoonMax
    && previous.state.teamEffects.unisonBoonPerStack === resolvedTeamEffects.unisonBoonPerStack
    ? previous.state.teamEffects : resolvedTeamEffects
  const team = scenarioTeamSlots(scenario)
  const stableTeam = previous && team.every((id, index) => id === previous.build.team[index])
    ? previous.build.team : team
  const teammates = scenario.team.members
    .filter((candidate) => candidate.id !== member.id)
    .slice(0, 2)
    .map((candidate) => compactMember(scenario, candidate))
  const teamRuntimes: ResRuntime['teamRuntimes'] = [teammates[0] ?? null, teammates[1] ?? null]
  const rotation = projectedRotation(scenario.program, member.resonatorId)
  if (previous && previous.build.team === stableTeam
    && previous.state.manualBuffs === manualBuffs
    && previous.state.teamEffects === teamEffects
    && previous.state.combat === scenario.environment.combatState
    && previous.rotation === rotation
    && teamRuntimes.every((runtime, index) => runtime === previous.teamRuntimes[index])) return previous

  const runtime: ResRuntime = {
    id: member.resonatorId,
    base: member.progression,
    build: previous?.build.team === stableTeam ? previous.build : {
      weapon: member.loadout.weapon,
      echoes: member.loadout.echoes,
      team: stableTeam,
    },
    state: {
      controls: member.local.controls,
      manualBuffs,
      combat: scenario.environment.combatState,
      teamEffects,
    },
    rotation,
    teamRuntimes,
  }
  runtimeByMember.set(member, runtime)
  return runtime
}

export function flattenScenarioRouting(
  scenario: CombatScenario,
): Record<string, string | null> {
  const memberById = new Map(
    scenario.team.members.map((member) => [member.id, member]),
  )
  const selectedTargets: Record<string, string | null> = {}

  for (const sourceMember of scenario.team.members) {
    const routes = scenario.environment.routing.bySourceMemberId[sourceMember.id] ?? {}
    for (const [ownerKey, targetMemberId] of Object.entries(routes)) {
      const targetMember = targetMemberId
        ? memberById.get(targetMemberId) ?? null
        : null
      selectedTargets[scopedTargetOwnerKey(sourceMember.resonatorId, ownerKey)] =
        targetMember?.resonatorId ?? null
    }
  }
  return selectedTargets
}

export interface ScenarioRuntimeProjection {
  teamSlots: TeamSlots
  subjectMemberId: TeamMemberId
  subjectRuntime: ResRuntime
  runtimesByMemberId: Record<TeamMemberId, ResRuntime>
  runtimesById: Record<string, ResRuntime>
  selectedTargets: Record<string, string | null>
}

// the live surface, evaluation rail, and engine adapter share a projection of
// the canonical scenario. replace it when the immutable scenario changes.
const projectionByScenario = new WeakMap<CombatScenario, ScenarioRuntimeProjection>()

export function projectScenarioRuntimes(
  scenario: CombatScenario,
): ScenarioRuntimeProjection {
  const cached = projectionByScenario.get(scenario)
  if (cached) return cached
  const subject = contextScenarioMember(scenario)
  const runtimesByMemberId = Object.fromEntries(
    scenario.team.members.map((member) => [
      member.id,
      projectScenarioMemberRuntime(scenario, member),
    ]),
  ) as Record<TeamMemberId, ResRuntime>
  const runtimesById = Object.fromEntries(
    scenario.team.members.map((member) => [
      member.resonatorId,
      runtimesByMemberId[member.id],
    ]),
  )

  const projection = {
    teamSlots: scenarioTeamSlots(scenario),
    subjectMemberId: subject.id,
    subjectRuntime: runtimesByMemberId[subject.id],
    runtimesByMemberId,
    runtimesById,
    selectedTargets: flattenScenarioRouting(scenario),
  }
  projectionByScenario.set(scenario, projection)
  return projection
}

const engineByProjection = new WeakMap<ScenarioRuntimeProjection, ScenarioRuntimeProjection>()
const engineByRuntime = new WeakMap<ResRuntime, ResRuntime>()
/** engine projection; environment sources are applied by the combat graph. */
export function projectScenarioEngineRuntimes(
  scenario: CombatScenario,
): ScenarioRuntimeProjection {
  const projection = projectScenarioRuntimes(scenario)
  const cached = engineByProjection.get(projection)
  if (cached) return cached
  const runtimesByMemberId = Object.fromEntries(
    Object.entries(projection.runtimesByMemberId).map(([memberId, runtime]) => [
      memberId,
      (() => {
        let engine = engineByRuntime.get(runtime)
        if (!engine) {
          engine = { ...runtime, state: { ...runtime.state, manualBuffs: makeEmptyManualBuffs() } }
          engineByRuntime.set(runtime, engine)
        }
        return engine
      })(),
    ]),
  ) as Record<TeamMemberId, ResRuntime>
  const runtimesById = Object.fromEntries(
    scenario.team.members.map((member) => [
      member.resonatorId,
      runtimesByMemberId[member.id],
    ]),
  )
  const engine = {
    ...projection,
    subjectRuntime: runtimesByMemberId[projection.subjectMemberId],
    runtimesByMemberId,
    runtimesById,
  }
  engineByProjection.set(projection, engine)
  return engine
}

/** temporary adapter for active-based ui: its visible subject is member zero. */
export function projectScenarioUiRuntimes(
  scenario: CombatScenario,
): ScenarioRuntimeProjection {
  const projection = projectScenarioRuntimes(scenario)
  const subject = primaryScenarioMember(scenario)
  if (subject.id === projection.subjectMemberId) return projection
  return {
    ...projection,
    subjectMemberId: subject.id,
    subjectRuntime: projection.runtimesByMemberId[subject.id],
  }
}

/**
 * compatibility-only profile projection for UI/import code. scenario members
 * remain the owners of this data; callers must never persist this result.
 */
export function projectScenarioProfiles(
  scenario: CombatScenario,
): Record<string, ResProf> {
  const member = primaryScenarioMember(scenario)
  return {
    [member.resonatorId]: projectScenarioMemberProfile(scenario, member),
  }
}

export function projectScenarioMemberProfile(
  scenario: CombatScenario,
  member: ScenarioTeamMember,
): ResProf {
  const routing = flattenScenarioRouting(scenario)
  const runtime = projectScenarioMemberRuntime(scenario, member)
  const controls = { ...normResRtCnt(runtime) }

  // the retired ResProf interchange shape stored teammate controls
  // on the context profile. encode that envelope only here so profile clipboard
  // round-trips cannot erase canonical scenario-member state.
  for (const teammate of scenario.team.members) {
    if (teammate.id === member.id) continue
    const prefix = `team:${teammate.resonatorId}:`
    const teammateRuntime = projectScenarioMemberRuntime(scenario, teammate)
    for (const [key, value] of Object.entries(normResRtCnt(teammateRuntime))) {
      controls[`${prefix}${key}`] = value
    }
  }

  return {
    resonatorId: member.resonatorId,
    runtime: {
      progression: cloneResBase(member.progression),
      build: {
        weapon: cloneWpnMkSt(member.loadout.weapon),
        echoes: cloneEchoLoadout(member.loadout.echoes),
      },
      local: {
        controls,
        manualBuffs: resolveEnvironmentManualBuffs(scenario.environment, member),
        combat: cloneCmbtStt(scenario.environment.combatState),
        setConditionals: cloneSntSet(member.local.setConditionals),
        optimizerInventory: cloneOptInventorySelection(member.local.optimizerInventory),
      },
      routing: {
        selectedTargetsByOwnerKey: { ...routing },
      },
      team: scenarioTeamSlots(scenario),
      rotation: cloneRotation(runtime.rotation),
      teamRuntimes: runtime.teamRuntimes,
    },
  } satisfies ResProf
}

/**
 * compatibility profile view with member zero from each context scenario,
 * used by ui and import consumers indexed by resonator.
 */
export function projectScenarioWorkspaceProfiles(
  workspace: Pick<ScenarioWorkspace, 'selectedScenarioId' | 'order' | 'scenariosById'>,
): Record<string, ResProf> {
  const profiles: Record<string, ResProf> = {}
  const selected = workspace.scenariosById[workspace.selectedScenarioId]

  for (const scenarioId of workspace.order) {
    if (scenarioId === workspace.selectedScenarioId) continue
    const scenario = workspace.scenariosById[scenarioId]
    if (scenario) Object.assign(profiles, projectScenarioProfiles(scenario))
  }
  if (selected) Object.assign(profiles, projectScenarioProfiles(selected))
  return profiles
}
