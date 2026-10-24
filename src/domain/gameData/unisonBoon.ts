/*
  Author: Runor Ewhro
  description: defines the team unison boon effect and its team-derived rules.
*/

import type { CondExpr, SourceState, SrcPkg } from '@/domain/gameData/contracts'
import type { ResRuntime } from '@/domain/entities/runtime'

const UNISON_BOON_ID = 'unisonBoon'
const UNISON_BOON_LABEL = 'Unison Boon'
const UNISON_BOON_OWNER_KEY = 'teamEffect:unisonBoon'
const UNISON_BOON_SOURCE = { type: 'teamEffect', id: UNISON_BOON_ID } as const
export const UNISON_BOON_TEAM_PATH = 'teamEffects.unisonBoon'
export const UNISON_BOON_RUNTIME_PATH = `runtime.state.${UNISON_BOON_TEAM_PATH}`
const UNISON_BOON_DESCRIPTION = 'Each stack of <span style="color:#ffd12f;" class="font-bold">Unison Boon</span> increases the total DMG dealt by Resonators in the team who can trigger <span style="color:#ffd12f;" class="font-bold"><te href=131112>Unison Response</te></span> by 3%, stacking up to 2 times. Only the Resonators who can trigger Unison Response can gain this effect.'

type Member = {
  resonatorId: string
  progression: { level: number; sequence: number }
  local: { controls: Record<string, boolean | number | string> }
}

function hsinInUnison(member: Member): boolean {
  return member.resonatorId === '1311'
    && member.local.controls['resonator:1311:mode:value'] !== 'electro_flare'
}

export function canTriggerUnisonResponse(member: Member): boolean {
  return member.resonatorId === '1312' || hsinInUnison(member)
}

/** recipient condition shared by authored effects that require Unison Response. */
export function unisonResponseCondition(): CondExpr {
  return {
    type: 'or', values: [
      { type: 'eq', from: 'targetRuntime', path: 'id', value: '1312' },
      { type: 'and', values: [
        { type: 'eq', from: 'targetRuntime', path: 'id', value: '1311' },
        { type: 'eq', from: 'targetRuntime', path: 'state.controls.resonator:1311:mode:value', value: 'unison' },
      ] },
    ],
  }
}

/** each rule can be roster-passive or gated by its owner's active state. */
const maxSources = [
  { resonatorId: '1311', value: 1, enabled: (member: Member) => hsinInUnison(member) && member.progression.level >= 70 },
  { resonatorId: '1311', value: 1, enabled: (member: Member) => hsinInUnison(member) && member.progression.sequence >= 6 },
] as const

export function unisonBoonMax(members: readonly Member[]): number {
  return 2 + maxSources.reduce((sum, source) => sum + (members.some(
    (member) => member.resonatorId === source.resonatorId && source.enabled(member),
  ) ? source.value : 0), 0)
}

export function unisonBoonMaxForRuntimes(runtimes: readonly ResRuntime[]): number {
  return unisonBoonMax(runtimes.map((runtime) => ({
    resonatorId: runtime.id,
    progression: runtime.base,
    local: { controls: runtime.state.controls },
  })))
}

export function unisonBoonPerStack(members: readonly Member[]): number {
  return members.some((member) => member.resonatorId === '1312' && member.progression.sequence >= 6)
    ? 4.5 : 3
}

export function resolveUnisonBoon(
  members: readonly Member[],
  storedStacks: number,
): { stacks: number; max: number; perStack: number } {
  const max = unisonBoonMax(members)
  return {
    stacks: Math.min(Math.max(0, Math.floor(Number.isFinite(storedStacks) ? storedStacks : 0)), max),
    max,
    perStack: unisonBoonPerStack(members),
  }
}

export const unisonBoonState: SourceState = {
  id: UNISON_BOON_ID,
  label: UNISON_BOON_LABEL,
  description: UNISON_BOON_DESCRIPTION,
  source: UNISON_BOON_SOURCE,
  ownerKey: UNISON_BOON_OWNER_KEY,
  controlKey: UNISON_BOON_TEAM_PATH,
  path: UNISON_BOON_RUNTIME_PATH,
  kind: 'stack',
  min: 0,
  max: 4,
  defaultValue: 0,
}

/** the shared state displayed on each eligible member's runtime. */
export function unisonBoonStateForRuntime(runtime: ResRuntime): SourceState | null {
  if (!canTriggerUnisonResponse({
    resonatorId: runtime.id,
    progression: runtime.base,
    local: { controls: runtime.state.controls },
  })) return null
  return { ...unisonBoonState, max: runtime.state.teamEffects?.unisonBoonMax ?? 2 }
}

/** this source is registered once; each eligible recipient gets one projection. */
export const unisonBoonSource: SrcPkg = {
  source: UNISON_BOON_SOURCE,
  states: [unisonBoonState],
  owners: [{
    id: UNISON_BOON_ID,
    label: UNISON_BOON_LABEL,
    description: UNISON_BOON_DESCRIPTION,
    source: UNISON_BOON_SOURCE,
    scope: 'team',
    kind: 'teamBuff',
    ownerKey: UNISON_BOON_OWNER_KEY,
  }],
  effects: [{
    id: 'teamEffect:unisonBoon:finalDmg',
    label: UNISON_BOON_LABEL,
    description: UNISON_BOON_DESCRIPTION,
    source: UNISON_BOON_SOURCE,
    ownerKey: UNISON_BOON_OWNER_KEY,
    trigger: 'runtime',
    targetScope: 'self',
    condition: unisonResponseCondition(),
    operations: [{
      type: 'add_top_stat',
      stat: 'finalDmg',
      value: { type: 'mul', values: [
        { type: 'read', from: 'sourceRuntime', path: 'state.teamEffects.unisonBoon', default: 0 },
        { type: 'read', from: 'sourceRuntime', path: 'state.teamEffects.unisonBoonPerStack', default: 3 },
      ] },
    }],
  }],
}
