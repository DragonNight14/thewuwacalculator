/*
  Author: Runor Ewhro
  description: initializes new teammates with the fullest available gear setup,
               controls, and effects.
*/

import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { contextScenarioMember, type CombatScenario, type ScenarioTeamMember } from '@/domain/entities/combatScenario'
import type { SavedBuild, SavedBuildSnap } from '@/domain/entities/inventoryStorage'
import { scenarioForContextResonator } from '@/domain/entities/scenarioLibrary'
import { makeResProfile, makeScenarioMemberFromProfile } from '@/engine/runtime/defaults'
import { useAppStore } from './store'
import { roverIdForGender } from '@/domain/entities/roverGender'

function filledEchoSlots(build: SavedBuildSnap): number {
  let filled = 0
  for (let index = 0; index < 5; index += 1) {
    if (build.echoes[index]) filled += 1
  }
  return filled
}

// call at the assignment boundary, before entering a store or draft reducer:
// inventory hydration can itself update the store.
export function makeInitialTeammate(resonatorId: string, destination: CombatScenario): ScenarioTeamMember | null {
  resonatorId = roverIdForGender(resonatorId, useAppStore.getState().ui.preferences.roverGender)
  const existing = destination.team.members.find((member) => member.resonatorId === resonatorId)
    ?? destination.dormantMembersByResonatorId?.[resonatorId]?.member
  if (existing) return existing

  const seed = getResSeedBy(resonatorId)
  if (!seed) return null

  const state = useAppStore.getState()
  const member = makeScenarioMemberFromProfile(makeResProfile(seed, {
    maxed: state.ui.preferences.maxResOnInit,
  }))
  const context = scenarioForContextResonator(state.combat, resonatorId)
  const source = context ? contextScenarioMember(context) : null
  let gear = source?.loadout
  const contextSlots = gear ? filledEchoSlots(gear) : -1

  // a full context setup already wins every tie, so the lazy inventory can stay unloaded.
  if (contextSlots < 5) {
    state.ensInvHydr()
    let best: SavedBuild | undefined
    let bestSlots = -1
    for (const build of useAppStore.getState().library.builds) {
      if (build.resonatorId !== resonatorId) continue
      const slots = filledEchoSlots(build.build)
      if (!best || slots > bestSlots || (slots === bestSlots && (
        build.updatedAt > best.updatedAt
        || (build.updatedAt === best.updatedAt && build.createdAt > best.createdAt)
      ))) {
        best = build
        bestSlots = slots
      }
    }
    if (best && bestSlots > contextSlots) {
      gear = best.build
    }
  }

  if (gear) member.loadout = structuredClone(gear)
  // inventory builds contain gear only. sequence belongs to the context member,
  // even when a more complete inventory build supplies the weapon and echoes.
  if (source) member.progression.sequence = source.progression.sequence
  return member
}
