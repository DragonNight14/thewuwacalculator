/*
  Author: Runor Ewhro
  description: applies undoable program edits and maintains bounded undo and redo stacks.
*/

import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { stripRotationNotes } from '@/domain/gameData/rotationNotes.ts'
import { extractLoopTemplateBody } from '@/domain/gameData/loopPasses.ts'
import type {
  EditorSection,
  LoopRunSelections,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import {
  checkinAllLoopPasses,
  checkoutAllLoopPasses,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/passCheckout.ts'
import { editorSectionsToRotation } from '@/modules/simulation/surfaces/rotation/program-editor/model/toRotationNodes.ts'

export interface RotationEditSnapshot {
  sections: EditorSection[]
  runsByLoopId: LoopRunSelections
  /** this exact authored state was committed through run at this time. */
  lastRanAt: number | null
  /** cached dirty key reused by undo and redo. */
  simulationKey?: string
}

interface RotationEditHistoryEntry {
  label: string
  before: RotationEditSnapshot
  after: RotationEditSnapshot
  coalesceKey?: string
  coalesceAt?: number
}

export interface RotationEditHistory {
  past: RotationEditHistoryEntry[]
  future: RotationEditHistoryEntry[]
}

/** hard cap on the number of undoable edits. unchanged nodes are shared. */
export const PAGE_EDIT_HISTORY_LIMIT = 40

export function emptyRotationEditHistory(): RotationEditHistory {
  return { past: [], future: [] }
}

/** the one immutable snapshot currently at the undo/redo cursor. */
export function rotationEditHistoryCursor(
  history: RotationEditHistory,
  current?: {
    runsByLoopId: LoopRunSelections
    simulationKey: string
    lastRanAt: number | null
  },
): RotationEditSnapshot | null {
  const snapshot = history.past.at(-1)?.after ?? history.future[0]?.before ?? null
  if (!snapshot || !current) return snapshot
  if (snapshot.simulationKey !== current.simulationKey) return null
  if (snapshot.lastRanAt !== current.lastRanAt) return null

  const snapshotRuns = Object.entries(snapshot.runsByLoopId)
  const currentRuns = Object.entries(current.runsByLoopId)
  if (snapshotRuns.length !== currentRuns.length) return null
  return snapshotRuns.every(([loopId, run]) => current.runsByLoopId[loopId] === run)
    ? snapshot
    : null
}

function trimPageEditHistory(
  past: RotationEditHistoryEntry[],
): RotationEditHistoryEntry[] {
  return past.length > PAGE_EDIT_HISTORY_LIMIT
    ? past.slice(-PAGE_EDIT_HISTORY_LIMIT)
    : past
}

export function captureRotationEditSnapshot(
  sections: EditorSection[],
  runsByLoopId: LoopRunSelections,
  simulationKey?: string,
  lastRanAt: number | null = null,
): RotationEditSnapshot {
  return {
    // editor mutations are immutable. share untouched projected nodes across
    // the bounded undo stack.
    sections: checkinAllLoopPasses(sections),
    runsByLoopId: { ...runsByLoopId },
    lastRanAt,
    ...(simulationKey !== undefined ? { simulationKey } : {}),
  }
}

export function restoreRotationEditSnapshot(
  snapshot: RotationEditSnapshot,
): RotationEditSnapshot {
  const sections = structuredClone(snapshot.sections)
  return {
    sections: checkoutAllLoopPasses(sections, snapshot.runsByLoopId),
    runsByLoopId: { ...snapshot.runsByLoopId },
    lastRanAt: snapshot.lastRanAt,
  }
}

/** execution-equivalent presentation edits retain the last qualified run. */
export function rotationEditRanAt(
  currentKey: string,
  nextKey: string,
  currentRanAt: number | null,
): number | null {
  return currentKey === nextKey ? currentRanAt : null
}

export function commitRotationEdit(
  history: RotationEditHistory,
  entry: RotationEditHistoryEntry,
): RotationEditHistory {
  const previous = history.past.at(-1)
  const coalesceAt = Date.now()
  if (entry.coalesceKey && previous?.coalesceKey === entry.coalesceKey
    && previous.coalesceAt !== undefined && coalesceAt - previous.coalesceAt <= 500) {
    return {
      past: [
        ...history.past.slice(0, -1),
        { ...previous, after: entry.after, label: entry.label, coalesceAt },
      ],
      future: [],
    }
  }
  return {
    past: trimPageEditHistory([
      ...history.past,
      { ...entry, coalesceAt: entry.coalesceKey ? coalesceAt : undefined },
    ]),
    future: [],
  }
}

export function undoRotationEdit(history: RotationEditHistory): {
  history: RotationEditHistory
  snapshot: RotationEditSnapshot | null
} {
  const entry = history.past.at(-1)
  if (!entry) {
    return { history, snapshot: null }
  }
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [entry, ...history.future],
    },
    snapshot: entry.before,
  }
}

export function redoRotationEdit(history: RotationEditHistory): {
  history: RotationEditHistory
  snapshot: RotationEditSnapshot | null
} {
  const entry = history.future[0]
  if (!entry) {
    return { history, snapshot: null }
  }
  return {
    history: {
      past: [...history.past, entry],
      future: history.future.slice(1),
    },
    snapshot: entry.after,
  }
}

/**
 * a run refreshes derived evaluation data without being an authored edit.
 * replace the cursor snapshot so undo and redo restore the refreshed result.
 */
export function refreshRotationHistoryCursor(
  history: RotationEditHistory,
  snapshot: RotationEditSnapshot,
): RotationEditHistory {
  const past = history.past.length > 0
    ? [
      ...history.past.slice(0, -1),
      { ...history.past.at(-1)!, after: snapshot },
    ]
    : history.past
  const future = history.future.length > 0
    ? [
      { ...history.future[0], before: snapshot },
      ...history.future.slice(1),
    ]
    : history.future
  return { past, future }
}

/* section placement affects authored execution state: preamble nodes are prepared
   before the main sequence. only fields that cannot change execution belong
   here, otherwise a cross-section drag never arms run. */
const NON_EXECUTABLE_FIELDS = new Set(['label', 'color'])

function withoutPresentationNode(node: RotationNode): RotationNode {
  const next = { ...node } as RotationNode & Record<string, unknown>
  for (const field of NON_EXECUTABLE_FIELDS) {
    delete next[field]
  }

  if (next.type === 'feature' && next.attached) {
    next.attached = {
      conditions: next.attached.conditions.map(withoutPresentationNode) as typeof next.attached.conditions,
      features: next.attached.features.map(withoutPresentationNode) as typeof next.attached.features,
    }
  } else if (next.type === 'repeat') {
    next.items = next.items.map(withoutPresentationNode)
  } else if (next.type === 'uptime') {
    next.items = next.items.map(withoutPresentationNode)
    if (next.setup) {
      next.setup = next.setup.map(withoutPresentationNode)
    }
  } else if (next.type === 'loop' && next.kind === 'start' && next.passForks) {
    next.passForks = Object.fromEntries(
      Object.entries(next.passForks).map(([run, body]) => [
        run,
        body.map(withoutPresentationNode),
      ]),
    )
  }

  return next
}

function withoutPresentationFields(items: RotationNode[]): RotationNode[] {
  return items.map(withoutPresentationNode)
}

function compactEquivalentPassForks(items: RotationNode[]): RotationNode[] {
  const out: RotationNode[] = []
  let index = 0
  while (index < items.length) {
    const source = items[index]
    if (!source) {
      index += 1
      continue
    }

    let node = source
    if (node.type === 'repeat') {
      node = { ...node, items: compactEquivalentPassForks(node.items) }
    } else if (node.type === 'uptime') {
      node = {
        ...node,
        ...(node.setup ? { setup: compactEquivalentPassForks(node.setup) } : {}),
        items: compactEquivalentPassForks(node.items),
      }
    } else if (node.type === 'feature' && node.attached) {
      node = {
        ...node,
        attached: {
          conditions: compactEquivalentPassForks(node.attached.conditions) as Extract<
            RotationNode,
            { type: 'condition' }
          >[],
          features: compactEquivalentPassForks(node.attached.features) as Extract<
            RotationNode,
            { type: 'feature' }
          >[],
        },
      }
    }

    if (node.type === 'loop' && node.kind === 'start') {
      const { body, endIndex } = extractLoopTemplateBody(items, index)
      if (endIndex != null) {
        const template = compactEquivalentPassForks(body)
        let inherited = template
        const passForks: Record<string, RotationNode[]> = {}
        const orderedForks = Object.entries(node.passForks ?? {})
          .sort(([left], [right]) => Number(left) - Number(right))
        for (const [run, sourceFork] of orderedForks) {
          const fork = compactEquivalentPassForks(sourceFork)
          if (JSON.stringify(fork) !== JSON.stringify(inherited)) {
            passForks[run] = fork
          }
          inherited = fork
        }
        out.push({
          ...node,
          ...(Object.keys(passForks).length > 0
            ? { passForks }
            : { passForks: undefined }),
        })
        out.push(...template)
        const end = items[endIndex]
        if (end) out.push(end)
        index = endIndex + 1
        continue
      }
    }

    out.push(node)
    index += 1
  }
  return out
}

function executableItems(
  sections: EditorSection[],
  originalItems: RotationNode[],
  options?: { checkedIn?: boolean },
): RotationNode[] {
  return compactEquivalentPassForks(withoutPresentationFields(stripRotationNotes(
    editorSectionsToRotation(sections, originalItems, options).flatMap((section) => section.items),
  )))
}

/**
 * serialize the canonical engine program while excluding projection-only
 * metadata. equality of this output defines the authored dirty boundary.
 */
export function rotationSimulationKey(
  sections: EditorSection[],
  originalItems: RotationNode[],
  options?: { checkedIn?: boolean },
): string {
  return JSON.stringify(executableItems(sections, originalItems, options))
}

/* a serialization that does not depend on the order the fields were written
   in, so two nodes assembled by different paths still compare as one value. */
function stableSignature(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSignature).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, held]) => held !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, held]) => `${JSON.stringify(key)}:${stableSignature(held)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/*
  sign each node independently of its contents. sign container bodies by their
  own ids and look them up separately.
  an edit inside a loop marks its own row. attachments stay part of their step;
  an attachment is drawn inside its parent's row and has none of its own.
*/
function signExecutableNodes(
  items: readonly RotationNode[],
  into: Map<string, string>,
): void {
  for (const node of items) {
    const own = { ...node } as RotationNode & Record<string, unknown>
    const bodies: RotationNode[] = []

    if (node.type === 'repeat' || node.type === 'uptime') {
      bodies.push(...node.items)
      const setup = (node as { setup?: RotationNode[] }).setup
      if (setup) bodies.push(...setup)
      delete own.items
      delete own.setup
    } else if (node.type === 'loop' && node.kind === 'start' && node.passForks) {
      for (const body of Object.values(node.passForks)) bodies.push(...body)
      delete own.passForks
    }

    into.set(node.id, stableSignature(own))
    signExecutableNodes(bodies, into)
  }
}

/**
 * `rotationSimulationKey` read one node at a time. both sides of a comparison
 * have to be signed by this function for the two to mean the same thing, which
 * is why the last run's signatures are taken when its baseline is taken.
 */
export function rotationNodeSignatures(
  sections: EditorSection[],
  originalItems: RotationNode[],
  options?: { checkedIn?: boolean },
): Map<string, string> {
  const signatures = new Map<string, string>()
  signExecutableNodes(executableItems(sections, originalItems, options), signatures)
  return signatures
}

/**
 * the nodes the last run either never saw, or saw as something else. which
 * section a node executes in is part of what it is, so moving one across the
 * preamble boundary marks it; reordering inside a section does not, and a
 * deleted node has no row left to mark. both of those still arm run, which is
 * why the band's pending count is taken from the tree, not from these marks.
 */
export function rotationStaleNodeIds(
  current: Map<string, string>,
  ran: Map<string, string>,
): Set<string> {
  const stale = new Set<string>()
  for (const [id, signature] of current) {
    if (ran.get(id) !== signature) stale.add(id)
  }
  return stale
}
