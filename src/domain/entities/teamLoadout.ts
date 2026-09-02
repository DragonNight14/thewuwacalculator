/*
  Author: Runor Ewhro
  Description: Defines team loadout storage entities and helper utilities for
               saving, comparing, and cloning complete team compositions.
*/

import type { EchoInstance, ResonatorId, ResRuntime, WeaponState } from './runtime'
import { cloneEchoLdt, makeStoreId } from './inventoryStorage'

export interface TeamMemberBuild {
  resonatorId: ResonatorId
  resonatorName: string
  level: number
  sequence: number
  weapon: WeaponState
  echoes: Array<EchoInstance | null>
}

export interface TeamLoadoutSnap {
  members: [TeamMemberBuild, TeamMemberBuild, TeamMemberBuild]
}

export interface InvTeamLoadout {
  id: string
  name: string
  loadout: TeamLoadoutSnap
  createdAt: number
  updatedAt: number
}

// Create a unique storage id
function makeStoreTeamId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// Clone a team member build
export function cloneTeamMemberBuild(member: TeamMemberBuild): TeamMemberBuild {
  return {
    resonatorId: member.resonatorId,
    resonatorName: member.resonatorName,
    level: member.level,
    sequence: member.sequence,
    weapon: { ...member.weapon },
    echoes: cloneEchoLdt(member.echoes),
  }
}

// Clone a team loadout snapshot
export function cloneTeamLoadoutSnap(loadout: TeamLoadoutSnap): TeamLoadoutSnap {
  return {
    members: loadout.members.map((member) => cloneTeamMemberBuild(member)) as [
      TeamMemberBuild,
      TeamMemberBuild,
      TeamMemberBuild,
    ],
  }
}

// Create an inventory team loadout entry
export function makeInvTeamLoadout(
  input: {
    name: string
    loadout: TeamLoadoutSnap
  },
  now = Date.now(),
): InvTeamLoadout {
  return {
    id: makeStoreTeamId(),
    name: input.name,
    loadout: cloneTeamLoadoutSnap(input.loadout),
    createdAt: now,
    updatedAt: now,
  }
}

// Compare two team loadout snapshots
export function areTeamLoadoutSnapsEqual(
  left: TeamLoadoutSnap,
  right: TeamLoadoutSnap,
): boolean {
  return left.members.every((leftMember, index) => {
    const rightMember = right.members[index]
    if (!rightMember) return false

    return (
      leftMember.resonatorId === rightMember.resonatorId
      && leftMember.weapon.id === rightMember.weapon.id
      && leftMember.weapon.level === rightMember.weapon.level
      && leftMember.weapon.rank === rightMember.weapon.rank
      && leftMember.echoes.length === rightMember.echoes.length
      && leftMember.echoes.every((echo, echoIdx) => {
        const rightEcho = rightMember.echoes[echoIdx]
        if (!echo || !rightEcho) return echo === rightEcho
        return (
          echo.id === rightEcho.id
          && echo.set === rightEcho.set
          && echo.mainStats.primary.key === rightEcho.mainStats.primary.key
          && echo.mainStats.primary.value === rightEcho.mainStats.primary.value
          && echo.mainStats.secondary.key === rightEcho.mainStats.secondary.key
          && echo.mainStats.secondary.value === rightEcho.mainStats.secondary.value
          && JSON.stringify(echo.substats) === JSON.stringify(rightEcho.substats)
        )
      })
    )
  })
}
