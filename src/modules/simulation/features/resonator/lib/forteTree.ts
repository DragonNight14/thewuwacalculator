/*
  Author: Runor Ewhro
  description: provides forte tree data and state helpers.
*/

import type { ResSeed } from '@/domain/entities/runtime.ts'
import { resInherentIcon, resNodeIcon } from '@/shared/lib/gameAssets.ts'
import { getResModeGroups } from '@/domain/gameData/resonatorStateGraph.ts'
import type { ResView, ResSldrSkllT } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { TRCNODEICONM, visibleTabs } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { skllLblMap } from '@/modules/simulation/features/resonator/lib/panel.ts'

type TraceNode = NonNullable<ResSeed['traceNodes']>[number]

export interface ForteTrace {
  id: string
  name: string
  value: string
  /* the sentence the catalog already authors for the node, "crit. dmg
     increased by 5.60%.". the tree has only ever drawn the bare figure. */
  desc: string
  statIcon: string | null
}

export interface ForteInherent {
  name: string
  unlockLevel: number
  icon: string | null
}

export interface ForteBranch {
  key: ResSldrSkllT
  label: string
  icon: string
  /* how many columns out from the forte spine this branch hangs */
  rank: number
  /*
    which way round the arc it hangs, so the surface can place it without
    counting siblings. the five columns sit on a circle, one every 20 degrees,
    which is why the outer pair compresses horizontally and drops much further.
  */
  side: 'l2' | 'l1' | 'c' | 'r1' | 'r2'
/* inner node followed by the outer node that requires it */
  traces: ForteTrace[]
  inherents: ForteInherent[]
}

/*
  four columns contain stat node pairs; the center column contains inherents.
  forteCircuit is handled separately.
*/
const TRACE_BRANCHES: ResSldrSkllT[] = [
  'normalAttack',
  'resonanceSkill',
  'resonanceLiberation',
  'introSkill',
]

/* center column for inherents and the two additional skills */
export const FORTE_SPINE: ResSldrSkllT = 'forteCircuit'

/* display order from left to right */
export const BRANCH_ORDER: ResSldrSkllT[] = [
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
]

/*
  the sigil the game hangs at the head of the tree for a resonator that fights
  in more than one resonance mode.
*/
export interface ForteMode {
  controlKey: string
  defaultValue: string
  options: Array<{ id: string; label: string; icon: string }>
}

/*
  only a mode the tree can actually draw qualifies: exactly two states the
  resonator switches between, each with its own art. that rules out phoebe,
  whose group is a status she can also be in neither of and which ships no
  icons, so her selector stays a plain control in the effects channel.
*/
export function mkForteMode(member: ResView): ForteMode | null {
  const group = getResModeGroups(member)
    .find((entry) => !entry.allowNone
      && entry.modes.length === 2
      && entry.modes.every((mode) => Boolean(mode.icon)))

  if (!group) {
    return null
  }

  return {
    controlKey: group.controlKey,
    defaultValue: group.defaultValue,
    options: group.modes.map((mode) => ({
      id: mode.id,
      label: mode.label,
      icon: mode.icon as string,
    })),
  }
}

function statIconFor(node: TraceNode, dark: boolean): string | null {
  const key = TRCNODEICONM[node.name]
  return key ? `/assets/game/skills/icons/${dark ? 'dark' : 'light'}/${key}.webp` : null
}

function toTrace(node: TraceNode, dark: boolean): ForteTrace {
  return {
    id: node.id,
    name: node.name,
    value: node.param?.[0] ?? '',
    desc: node.desc ?? '',
    statIcon: statIconFor(node, dark),
  }
}

/*
  the catalog lists inner nodes before outer nodes. pair each node at i with
  the node half a list later. an uneven list renders inner nodes alone.
*/
function traceColumns(nodes: TraceNode[], dark: boolean): ForteTrace[][] {
  const half = Math.floor(nodes.length / 2)
  if (half === 0) {
    return []
  }

  const paired = nodes.length === half * 2
  return Array.from({ length: half }, (_, index) => (
    paired
      ? [toTrace(nodes[index], dark), toTrace(nodes[index + half], dark)]
      : [toTrace(nodes[index], dark)]
  ))
}

export function mkForteTree(member: ResView, dark: boolean): ForteBranch[] {
  const columns = traceColumns(member.traceNodes ?? [], dark)
  const tabs = new Set(visibleTabs(member))
  const inherents: ForteInherent[] = (member.inherentSkills ?? []).map((skill, order) => ({
    name: skill.name,
    unlockLevel: Number(skill.unlockLevel) || 0,
    icon: resInherentIcon(member.id, order),
  }))

  const shown = BRANCH_ORDER.filter((key) => tabs.has(key))
  // each column stores its distance from the spine. the surface derives its
  // height from that distance.
  const spineAt = shown.indexOf(FORTE_SPINE)

  return shown.map((key, index) => {
    const traceIndex = TRACE_BRANCHES.indexOf(key)
    const step = spineAt < 0 ? 0 : index - spineAt
    const rank = Math.abs(step)
    return {
      key,
      label: skllLblMap[key] ?? key,
      icon: resNodeIcon(member.id, key),
      rank,
      side: (rank === 0 ? 'c' : `${step < 0 ? 'l' : 'r'}${rank}`) as ForteBranch['side'],
      traces: traceIndex >= 0 ? columns[traceIndex] ?? [] : [],
      inherents: key === FORTE_SPINE ? inherents : [],
    }
  })
}

/*
  two skills dock on the spine. the outro skill has no level; each docked
  skill declares whether it is levelled.
*/
export interface ForteDock {
  key: ResSldrSkllT | 'outroSkill'
  label: string
  icon: string
  levelled: boolean
}

/*
  always render the two additional nodes. outro has no level, and tune break
  may have only one value, so neither necessarily appears in the slider tabs.
*/
export function mkForteDock(member: ResView): ForteDock[] {
  const levelled = new Set(visibleTabs(member))

  return [
    { key: 'outroSkill' as const, levelled: false },
    { key: 'tuneBreak' as const, levelled: levelled.has('tuneBreak') },
  ].map((entry) => ({
    ...entry,
    label: skllLblMap[entry.key] ?? entry.key,
    icon: resNodeIcon(member.id, entry.key),
  }))
}
