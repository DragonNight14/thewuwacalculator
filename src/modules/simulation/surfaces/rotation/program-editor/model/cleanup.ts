/*
  Author: Runor Ewhro
  description: classifies inert or unreachable rotation nodes from execution
               evidence and applies cleanup through canonical tree operations.
*/

import type {
  EditorNode,
  EditorSection,
  EditorStep,
  EditorBlock,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import type { DataSrcRef, RtChng } from '@/domain/gameData/contracts.ts'
import { makeSourceKey } from '@/data/gameData/registry.ts'
import { isEditorBlock } from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import {
  isCheckoutableLoop,
  resolveEditorPassBody,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/passCheckout.ts'
import { editorLoopId } from '@/modules/simulation/surfaces/rotation/program-editor/model/executionScope.ts'
import { normLoopRuns } from '@/domain/gameData/rotationLoops.ts'
import { ACTIVE_RESONATOR_PATH } from '@/domain/gameData/rotationPaths.ts'

export type CleanupReason =
  /** ran, and wrote only what the state already held */
  | 'inert'
  /** the run never reached it, or could not resolve what it names */
  | 'dead'
  /** attached setters repeated immediately afterward as persistent setters */
  | 'redundant'

export interface CleanupTarget {
  readonly id: string
  readonly reason: CleanupReason
  /** one logical pass body, when only that execution was inert/dead. */
  readonly loopId?: string
  readonly run?: number
  /** the following persistent setters are moved before this feature. */
  readonly followingConditionIds?: readonly string[]
  /** these persistent setters already precede the feature. */
  readonly precedingConditionIds?: readonly string[]
}

export interface CleanupPlan {
  /** in tree order, so a caller can report the sweep the way it reads */
  readonly targets: readonly CleanupTarget[]
}

export interface CleanupSourceContext {
  /** sources currently represented by the live team/build and enemy. */
  readonly availableSources: ReadonlySet<string>
}

const EMPTY_PLAN: CleanupPlan = Object.freeze({
  targets: Object.freeze([]) as readonly CleanupTarget[],
})

export interface CleanupCounts {
  readonly inert: number
  readonly dead: number
  readonly redundant: number
  readonly total: number
}

export function cleanupCounts(plan: CleanupPlan): CleanupCounts {
  let inert = 0
  let dead = 0
  let redundant = 0
  for (const target of plan.targets) {
    if (target.reason === 'inert') inert += 1
    else if (target.reason === 'dead') dead += 1
    else redundant += 1
  }
  return { inert, dead, redundant, total: plan.targets.length }
}

function sameSetter(left: RtChng, right: RtChng): boolean {
  return left.type === 'set' && right.type === 'set'
    && left.path === right.path
    && left.resonatorId === right.resonatorId
    && Object.is(left.value, right.value)
}

/**
 * only hoist a complete, consecutive set of plain persistent setters. the
 * attached copies already apply before the feature, so hoisting the matching
 * persistent writes gives the feature the same state and keeps it afterward.
 */
function adjacentDuplicateSetters(
  nodes: readonly EditorNode[],
  index: number,
  side: 'before' | 'after',
): readonly string[] | null {
  const step = nodes[index]
  if (step?.type !== 'step' || step.disabled || step.gate?.kind === 'dead') return null
  const source = step.sourceNode
  if (source?.type !== 'feature' || source.enabled === false) return null
  const attached = source.attached?.conditions ?? []
  if (source.changes?.length || attached.length === 0 || attached.length !== step.changes?.length) {
    return null
  }
  if (attached.some((node) => node.enabled === false || node.note || node.label || node.changes.length !== 1)) {
    return null
  }
  const changes = step.changes ?? []
  if (changes.some((change) => change.type !== 'set')) return null
  if (side === 'before' && index < changes.length) return null
  const nearby = side === 'before'
    ? nodes.slice(index - changes.length, index)
    : nodes.slice(index + 1, index + 1 + changes.length)
  if (nearby.length !== changes.length) return null
  const unmatched = [...changes]
  for (const node of nearby) {
    if (node.type !== 'condition' || node.disabled || node.attachedNote
      || node.gate?.kind === 'dead' || node.sourceNode?.type !== 'condition'
      || node.sourceNode.changes.length !== 1) return null
    const write = node.change ?? node.sourceNode.changes[0]
    if (!write) return null
    const match = unmatched.findIndex((change) => sameSetter(change, write))
    if (match < 0) return null
    unmatched.splice(match, 1)
  }
  return unmatched.length === 0 ? nearby.map((node) => node.id) : null
}

/**
 * containers are never cleanup candidates. empty containers are valid authored
 * placeholders even when the last execution produced no evidence for them.
 */
function targetFor(node: EditorNode): CleanupReason | null {
  if (node.type === 'note' || isEditorBlock(node)) return null
  if (node.gate?.kind === 'dead') return 'dead'
  if (node.gate?.kind === 'inert') return 'inert'
  return null
}

function sourcesFor(node: EditorNode): DataSrcRef[] {
  const sources: DataSrcRef[] = []
  const sourceResonatorId = node.sourceNode && 'resonatorId' in node.sourceNode
    ? node.sourceNode.resonatorId
    : undefined
  if (node.type === 'condition') {
    if (node.state?.source) sources.push(node.state.source)
    if (node.change?.resonatorId) {
      sources.push({ type: 'resonator', id: node.change.resonatorId })
    }
    if (sourceResonatorId) {
      sources.push({ type: 'resonator', id: sourceResonatorId })
    }
  } else if (node.type === 'step') {
    sources.push(node.owner.kind === 'member'
      ? { type: 'resonator', id: node.owner.memberId }
      : { type: 'echo', id: node.owner.echoId })
    if (sourceResonatorId) {
      sources.push({ type: 'resonator', id: sourceResonatorId })
    }
  } else if (node.type === 'swap') {
    if (sourceResonatorId) {
      sources.push({ type: 'resonator', id: sourceResonatorId })
    }
    const authoredTarget = node.sourceNode?.changes.find(
      (change) => change.path === ACTIVE_RESONATOR_PATH,
    )?.value
    const targetId = typeof authoredTarget === 'string' ? authoredTarget : node.to
    if (targetId) {
      sources.push({ type: 'resonator', id: targetId })
    }
  }
  return sources
}

export function planRotationCleanup(
  sections: readonly EditorSection[],
  context?: CleanupSourceContext,
): CleanupPlan {
  const targets: CleanupTarget[] = []
  const targetKeys = new Set<string>()
  const globalTargetIds = new Set<string>()

  const addTarget = (target: CleanupTarget): void => {
    if (globalTargetIds.has(target.id)) return
    const scoped = target.loopId != null && target.run != null
    if (!scoped) {
      globalTargetIds.add(target.id)
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        if (targets[index]?.id === target.id) targets.splice(index, 1)
      }
    }
    const key = scoped ? `${target.id}\u0000${target.loopId}\u0000${target.run}` : target.id
    if (targetKeys.has(key)) return
    targetKeys.add(key)
    targets.push(target)
  }

  const visit = (
    nodes: readonly EditorNode[],
    inheritedDisabled: boolean,
    pass?: { loopId: string; run: number },
  ): void => {
    const followingKeptByHoist = new Set<string>()
    const redundantByIndex = new Map<number, Pick<CleanupTarget, 'precedingConditionIds' | 'followingConditionIds'>>()
    if (!inheritedDisabled) {
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]!
        const precedingConditionIds = adjacentDuplicateSetters(nodes, index, 'before')
        const followingConditionIds = precedingConditionIds
          ? null
          : adjacentDuplicateSetters(nodes, index, 'after')
        const adjacentIds = precedingConditionIds ?? followingConditionIds
        if (!adjacentIds) continue
        const sourcesPresent = !context || [node, ...adjacentIds
          .map((id) => nodes.find((candidate) => candidate.id === id))
          .filter((candidate): candidate is EditorNode => candidate != null)]
          .every((candidate) => sourcesFor(candidate).every((source) => (
            context.availableSources.has(makeSourceKey(source))
          )))
        if (!sourcesPresent) continue
        adjacentIds.forEach((id) => followingKeptByHoist.add(id))
        redundantByIndex.set(index, {
          ...(precedingConditionIds ? { precedingConditionIds } : {}),
          ...(followingConditionIds ? { followingConditionIds } : {}),
        })
      }
    }
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!
      const ownDisabled = 'disabled' in node && Boolean(node.disabled)
      const disabled = inheritedDisabled || ownDisabled

      if (isEditorBlock(node)) {
        const childDisabled = node.type === 'loop' ? inheritedDisabled : disabled
        if (isCheckoutableLoop(node)) {
          const template = node.passTemplate ?? node.children
          const loopId = editorLoopId(node)
          for (let run = 1; run <= normLoopRuns(node.runs); run += 1) {
            visit(
              resolveEditorPassBody(template, node.passForks, run),
              childDisabled,
              { loopId, run },
            )
          }
        } else {
          visit(node.children, childDisabled, pass)
        }
        continue
      }

      if (node.type === 'step' && node.attached) {
        visit(node.attached, disabled, pass)
      }
      if (disabled) continue

      const redundant = redundantByIndex.get(index)
      if (redundant) {
        addTarget({
          id: node.id,
          reason: 'redundant',
          ...(pass ? { loopId: pass.loopId, run: pass.run } : {}),
          ...redundant,
        })
      }

      const sourceMissing = Boolean(
        context
        && sourcesFor(node).some((source) => (
          !context.availableSources.has(makeSourceKey(source))
        )),
      )
      let reason = sourceMissing ? 'dead' : targetFor(node)
      if (followingKeptByHoist.has(node.id)) reason = null
      let scoped = false
      if (
        !sourceMissing
        && pass
        && (node.type === 'condition' || node.type === 'swap')
      ) {
        const passGate = node.gateByRun?.[pass.run]
        reason = passGate?.kind
          ?? (node.gate?.kind === 'dead' ? 'dead' : null)
        scoped = reason != null
      }
      if (!reason) continue
      addTarget(scoped
        ? { id: node.id, reason, loopId: pass!.loopId, run: pass!.run }
        : { id: node.id, reason })
    }
  }

  for (const section of sections) {
    visit(section.children, false)
  }

  if (targets.length === 0) return EMPTY_PLAN
  return Object.freeze({
    targets: Object.freeze(targets.map((target) => Object.freeze(target))),
  })
}

type ScopedCleanupTargets = ReadonlyMap<string, ReadonlyMap<number, ReadonlySet<string>>>
type ScopedHoists = ReadonlyMap<string, ReadonlyMap<number, readonly CleanupTarget[]>>

function scopedTargets(plan: CleanupPlan): ScopedCleanupTargets {
  const mutable = new Map<string, Map<number, Set<string>>>()
  for (const target of plan.targets) {
    if (target.reason === 'redundant' || target.loopId == null || target.run == null) continue
    let byRun = mutable.get(target.loopId)
    if (!byRun) {
      byRun = new Map()
      mutable.set(target.loopId, byRun)
    }
    let ids = byRun.get(target.run)
    if (!ids) {
      ids = new Set()
      byRun.set(target.run, ids)
    }
    ids.add(target.id)
  }
  return mutable
}

function scopedHoists(plan: CleanupPlan): ScopedHoists {
  const hoists = new Map<string, Map<number, CleanupTarget[]>>()
  for (const target of plan.targets) {
    if (target.reason !== 'redundant' || target.loopId == null || target.run == null) continue
    let byRun = hoists.get(target.loopId)
    if (!byRun) {
      byRun = new Map()
      hoists.set(target.loopId, byRun)
    }
    const list = byRun.get(target.run) ?? []
    list.push(target)
    byRun.set(target.run, list)
  }
  return hoists
}

function hoistFollowingSetters(
  nodes: readonly EditorNode[],
  targets: readonly CleanupTarget[],
): readonly EditorNode[] {
  if (targets.length === 0) return nodes
  const byStep = new Map(targets.map((target) => [target.id, target]))
  let changed = false
  const next: EditorNode[] = []
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!
    const target = byStep.get(node.id)
    const following = target?.followingConditionIds
    const preceding = target?.precedingConditionIds
    const beforeMatches = preceding?.length
      && preceding.every((id, offset) => nodes[index - preceding.length + offset]?.id === id)
      && adjacentDuplicateSetters(nodes, index, 'before')
    const afterMatches = following?.length
      && following.every((id, offset) => nodes[index + offset + 1]?.id === id)
      && adjacentDuplicateSetters(nodes, index, 'after')
    if (node.type === 'step' && (beforeMatches || afterMatches)) {
      if (afterMatches && following) next.push(...nodes.slice(index + 1, index + 1 + following.length))
      next.push({
        ...node,
        changes: undefined,
        changesEdited: true,
        attachedChangesByRun: undefined,
        writesByRun: undefined,
        pendingWrites: undefined,
      })
      if (afterMatches && following) index += following.length
      changed = true
      continue
    }
    if (isEditorBlock(node)) {
      const children = hoistFollowingSetters(node.children, targets)
      const passTemplate = node.passTemplate
        ? hoistFollowingSetters(node.passTemplate, targets)
        : undefined
      let passForks = node.passForks
      if (node.passForks) {
        let forkChanged = false
        const forks: Record<number, EditorNode[]> = {}
        for (const [run, body] of Object.entries(node.passForks)) {
          const updated = hoistFollowingSetters(body, targets)
          forks[Number(run)] = updated === body ? body : [...updated]
          forkChanged ||= updated !== body
        }
        if (forkChanged) passForks = forks
      }
      if (children !== node.children || passTemplate !== node.passTemplate || passForks !== node.passForks) {
        next.push({
          ...node,
          children: [...children],
          nodeCount: children.length,
          ...(passTemplate ? { passTemplate: [...passTemplate] } : {}),
          ...(passForks ? { passForks } : {}),
        })
        changed = true
        continue
      }
    }
    next.push(node)
  }
  return changed ? next : nodes
}

/** a cleanup must not merge pass bodies merely because their display fields
 * match. their node ids identify distinct authored actions and trace rows. */
function mapCleanupPassBodies(
  block: EditorBlock,
  mapper: (body: readonly EditorNode[], run: number) => readonly EditorNode[],
): EditorBlock {
  const template = block.passTemplate ?? block.children
  const previousForks = block.passForks ?? {}
  const nextForks: Record<number, EditorNode[]> = {}
  let nextTemplate = template
  let inherited: readonly EditorNode[] = template
  let changed = false
  const bodies: EditorNode[][] = []

  for (let run = 1; run <= normLoopRuns(block.runs); run += 1) {
    const original = resolveEditorPassBody(template, previousForks, run)
    const mapped = mapper(original, run)
    const body = mapped === original ? original : [...mapped]
    changed ||= body !== original
    bodies.push([...body])

    if (run === 1 && previousForks[1] == null) {
      nextTemplate = body
    } else if (previousForks[run] != null || JSON.stringify(body) !== JSON.stringify(inherited)) {
      nextForks[run] = [...body]
    }
    inherited = body
  }

  if (!changed) return block
  const checkedOutRun = Math.min(Math.max(1, block.checkedOutRun ?? 1), bodies.length)
  const children = bodies[checkedOutRun - 1] ?? [...nextTemplate]
  return {
    ...block,
    children,
    nodeCount: children.length,
    passTemplate: [...nextTemplate],
    passForks: Object.keys(nextForks).length > 0 ? nextForks : undefined,
  }
}

function applyScopedCleanup(
  nodes: readonly EditorNode[],
  targets: ScopedCleanupTargets,
  hoists: ScopedHoists,
): readonly EditorNode[] {
  let changed = false
  const next = nodes.map((node) => {
    if (!isEditorBlock(node)) return node
    if (isCheckoutableLoop(node)) {
      const loopTargets = targets.get(editorLoopId(node))
      const loopHoists = hoists.get(editorLoopId(node))
      const mapped = mapCleanupPassBodies(node, (body, run) => {
        let passBody = applyScopedCleanup(body, targets, hoists)
        const passHoists = loopHoists?.get(run)
        if (passHoists) passBody = hoistFollowingSetters(passBody, passHoists)
        const ids = loopTargets?.get(run)
        if (ids && ids.size > 0) passBody = removeFromNodes(passBody, ids)
        return passBody === body ? body : [...passBody]
      })
      changed ||= mapped !== node
      return mapped
    }
    const children = applyScopedCleanup(node.children, targets, hoists)
    if (children === node.children) return node
    changed = true
    return { ...node, children: [...children], nodeCount: children.length }
  })
  return changed ? next : nodes
}

function removeAttached(
  children: readonly EditorStep[],
  ids: ReadonlySet<string>,
): readonly EditorStep[] {
  let changed = false
  const next: EditorStep[] = []

  for (const child of children) {
    if (ids.has(child.id)) {
      changed = true
      continue
    }

    if (!child.attached) {
      next.push(child)
      continue
    }

    const attached = removeAttached(child.attached, ids)
    if (attached === child.attached) {
      next.push(child)
    } else {
      changed = true
      next.push({ ...child, attached: [...attached], attachedEdited: true })
    }
  }

  return changed ? next : children
}

function removeFromNodes(
  nodes: readonly EditorNode[],
  ids: ReadonlySet<string>,
): readonly EditorNode[] {
  let changed = false
  const next: EditorNode[] = []

  for (const node of nodes) {
    if (ids.has(node.id)) {
      changed = true
      continue
    }

    let current = node
    if (node.type === 'step' && node.attached) {
      const attached = removeAttached(node.attached, ids)
      if (attached !== node.attached) {
        current = { ...node, attached: [...attached], attachedEdited: true }
        changed = true
      }
    }

    if (isEditorBlock(node)) {
      const children = removeFromNodes(node.children, ids)
      const passTemplate = node.passTemplate
        ? removeFromNodes(node.passTemplate, ids)
        : undefined
      let passForks = node.passForks
      if (node.passForks) {
        let forksChanged = false
        const nextForks: Record<number, EditorNode[]> = {}
        for (const [run, body] of Object.entries(node.passForks)) {
          const nextBody = removeFromNodes(body, ids)
          nextForks[Number(run)] = nextBody === body ? body : [...nextBody]
          forksChanged ||= nextBody !== body
        }
        if (forksChanged) passForks = nextForks
      }
      const bodyChanged = children !== node.children
        || passTemplate !== node.passTemplate
        || passForks !== node.passForks
      if (bodyChanged) {
        current = {
          ...node,
          children: [...children],
          nodeCount: children.length,
          ...(passTemplate ? { passTemplate: [...passTemplate] } : {}),
          ...(passForks ? { passForks } : {}),
        }
        changed = true
      }
    }

    next.push(current)
  }

  return changed ? next : nodes
}

/** removing a swept row is the same edit as deleting it by hand, including
 * copies held by loop pass storage and attached feature rows. */
export function applyRotationCleanup(
  sections: EditorSection[],
  plan: CleanupPlan,
): EditorSection[] {
  if (plan.targets.length === 0) return sections
  const ids = new Set(plan.targets.flatMap((target) => (
    target.reason !== 'redundant' && (target.loopId == null || target.run == null)
      ? [target.id]
      : []
  )))
  const perPass = scopedTargets(plan)
  const perPassHoists = scopedHoists(plan)
  const globalHoists = plan.targets.filter((target) => (
    target.reason === 'redundant' && target.loopId == null
  ))
  let changed = false
  const next = sections.map((section) => {
    const scoped = perPass.size > 0 || perPassHoists.size > 0
      ? applyScopedCleanup(section.children, perPass, perPassHoists)
      : section.children
    const hoisted = globalHoists.length > 0 ? hoistFollowingSetters(scoped, globalHoists) : scoped
    const children = ids.size > 0 ? removeFromNodes(hoisted, ids) : hoisted
    if (children === section.children) return section
    changed = true
    return { ...section, children: [...children] }
  })
  return changed ? next : sections
}

/** one phrasing of a plan, so the prompt and the toast never disagree. */
export function describeRotationCleanup(plan: CleanupPlan): string {
  const { inert, dead, redundant } = cleanupCounts(plan)
  const rows = (count: number) => `${count} ${count === 1 ? 'node' : 'nodes'}`
  const parts = [
    inert > 0 ? `${rows(inert)} that didn't actually change` : null,
    dead > 0 ? `${rows(dead)} the last run never used` : null,
    redundant > 0
      ? `${redundant} ${redundant === 1 ? 'skill' : 'skills'} with attached setters duplicated by adjacent persistent setters`
      : null,
  ].filter(Boolean)
  return `${parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}` : parts[0]}.`
}
