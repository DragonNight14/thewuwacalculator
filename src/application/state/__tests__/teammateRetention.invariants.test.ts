/*
  Author: Runor Ewhro
  description: keeps teammate configuration through roster changes and storage
               without allowing off-team members to enter combat projections.
*/

import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/application/state/store'
import { consumePersist, parsePersisted } from '@/application/persistence/storage'
import { listEchoes } from '@/data/catalog/echoCatalogService'
import { listResSds } from '@/data/catalog/resonatorSeedService'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import { teamMemberId } from '@/domain/entities/combatScenario'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { makeAppState, makeResProfile, makeScenarioMemberFromProfile } from '@/engine/runtime/defaults'
import { prepareCombatScenario } from '@/engine/pipeline/combatScenario'
import { makeMemberManualEffect, resolveEnvironmentManualBuffs } from '@/engine/runtime/scenarioEnvironment'
import { insertScenarioTeamMember, removeScenarioTeamMember, replaceScenarioTeamMember } from '@/engine/runtime/scenarioMembers'
import { withSupports } from '@/modules/simulation/features/teams/lib/teamSlots'

function makeMember(resonatorId = '1211') {
  const seed = listResSds().find((candidate) => candidate.id === resonatorId)!
  return makeScenarioMemberFromProfile(makeResProfile(seed, { maxed: true }))
}

function configuredMember() {
  const member = makeMember()
  const echo = listEchoes().find((candidate) => candidate.sets.length > 0)!
  const primary = Object.entries(ECHO_MAIN_STATS[echo.cost])[0]
  member.progression.level = 80
  member.progression.sequence = 2
  member.loadout.weapon.rank = 3
  member.loadout.echoes[0] = {
    id: echo.id,
    uid: 'retained-echo',
    set: echo.sets[0],
    mainEcho: true,
    mainStats: {
      primary: { key: primary[0], value: primary[1] },
      secondary: { ...ECHO_SIDE_STATS[echo.cost] },
    },
    substats: { critRate: 6.3 },
  }
  member.local.controls = {
    ...member.local.controls,
    'resonator:1211:mode:value': 'tune_strain',
    'weapon:retained:active': false,
    'echo:retained:stacks': 0,
    'sonata:retained:active': false,
  }
  member.local.setConditionals = { version: 1, encoding: 'off-v1', off: { '1': ['5pc'] } }
  member.local.optimizerInventory = { mode: 'include', echoUids: ['retained-echo'] }
  return member
}

describe('teammate configuration retention', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumePersist()
  })

  it('keeps the complete setup through removal, persistence, and rejoining a different seat', () => {
    const base = selectedCombatScenario(useAppStore.getState().combat)
    const member = configuredMember()
    useAppStore.getState().insertScenarioMember(base.id, 1, member)
    useAppStore.getState().updateScenarioMember(base.id, member.id, () => member)
    const buffs = makeResProfile(listResSds()[0]).runtime.local.manualBuffs
    buffs.quick.atk.percent = 17
    useAppStore.getState().upsertEnvironmentManualEffect(base.id, makeMemberManualEffect(member.id, buffs))
    useAppStore.getState().removeScenarioMember(base.id, member.id)

    const removed = selectedCombatScenario(useAppStore.getState().combat)
    const prepared = prepareCombatScenario(removed)
    expect(prepared.runtimesById).not.toHaveProperty(member.resonatorId)
    expect(prepared.subjectRuntime.state.controls).not.toHaveProperty('resonator:1211:mode:value')
    expect(resolveEnvironmentManualBuffs(removed.environment, removed.team.members[0]).quick.atk.percent).toBe(0)

    const state = makeAppState()
    state.combat = useAppStore.getState().combat
    const loaded = selectedCombatScenario(parsePersisted(JSON.stringify(state)).combat)
    const otherId = listResSds().find((seed) => seed.id !== member.resonatorId && seed.id !== base.team.members[0].resonatorId)!.id
    const withOther = insertScenarioTeamMember(loaded, 1, makeMember(otherId))
    const fresh = { ...makeMember(), id: teamMemberId('new-seat') }
    const rejoined = insertScenarioTeamMember(withOther, 2, fresh)
    expect(rejoined.team.members[2]).toEqual({ ...member, id: fresh.id })
    expect(resolveEnvironmentManualBuffs(rejoined.environment, rejoined.team.members[2]!).quick.atk.percent).toBe(17)
    expect(consumePersist()).toContain('combat.workspace')
  })

  it('retains each resonator independently across replacements and later edits', () => {
    const base = selectedCombatScenario(makeAppState().combat)
    const member = configuredMember()
    const otherId = listResSds().find((seed) => seed.id !== member.resonatorId && seed.id !== base.team.members[0].resonatorId)!.id
    let scenario = insertScenarioTeamMember(base, 1, member)
    scenario = replaceScenarioTeamMember(scenario, member.id, makeMember(otherId))
    scenario = replaceScenarioTeamMember(scenario, member.id, makeMember())
    expect(scenario.team.members[1]).toEqual(member)

    const edited = structuredClone(scenario.team.members[1]!)
    edited.local.controls['echo:retained:stacks'] = 4
    scenario = replaceScenarioTeamMember(scenario, member.id, edited)
    scenario = removeScenarioTeamMember(scenario, member.id)
    scenario = insertScenarioTeamMember(scenario, 1, makeMember())
    expect(scenario.team.members[1]).toEqual(edited)
    expect(insertScenarioTeamMember(base, 1, makeMember()).team.members[1]).toEqual(makeMember())
  })

  it('retains configuration when the picker clears and reapplies the support list', () => {
    const base = selectedCombatScenario(makeAppState().combat)
    const member = configuredMember()
    const initial = insertScenarioTeamMember(base, 1, member)
    const cleared = withSupports(initial, [], makeMember)
    const rejoined = withSupports(cleared, [member.resonatorId], makeMember)
    expect(rejoined.team.members[1]).toEqual(member)
    expect(initial.team.members[1]).toEqual(member)
    expect(withSupports(initial, [base.team.members[0].resonatorId, member.resonatorId], makeMember)).toBe(initial)
  })
})
