/*
  Author: Runor Ewhro
  description: persists scenario manifests and section records incrementally,
               with lazy validation, migration, reuse, and orphan cleanup.
*/

import { compressToUTF16, decompressFromUTF16 } from 'lz-string'
import type { PersistedState } from '@/domain/entities/appState'
import { makeScenarioTeam, contextScenarioMember, type CombatScenario, type CombatScenarioId } from '@/domain/entities/combatScenario'
import { summarizeScenario, type ScenarioSummary } from '@/domain/entities/scenarioLibrary'
import { normalizeStoredCombatScenario } from '@/engine/runtime/defaults'
import { isRotationSequence } from '@/domain/gameData/rotationSequence'
import {
  APP_STATE_VER, parseCombatScenario, parseScenarioMember, parseScenarioTarget,
  parseScenarioEnvironment, parseScenarioProgram, parseDormantScenarioMembers,
} from '@/engine/runtime/schema'
import { readStoredScenarioIds } from './resonatorScope'
import { APPSTORECMBT, APPSTORECMBTINDEX, APPSTORECMBTREC } from './storageKeys'
import { COMPRESSED_ROTATIONS_PREFIX } from './storageCodec'

export class ScenarioRecordRepository {
  private serial = 0
  private lastManifest: string | null = null
  private readonly savedRefs = new Map<string, CombatScenario>()
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null

  writeRecord(id: string, part: string, value: unknown, created: string[]): string {
    const key = `${APPSTORECMBTREC}${encodeURIComponent(id)}.${Date.now().toString(36)}.${this.serial++}.${part}`
    const json = JSON.stringify(value)
    localStorage.setItem(key, json.length < 1024 ? json : `${COMPRESSED_ROTATIONS_PREFIX}${compressToUTF16(json)}`)
    created.push(key)
    return key
  }

  scheduleCleanup(): void {
    if (this.cleanupTimer !== null) clearTimeout(this.cleanupTimer)
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = null
      const raw = localStorage.getItem(APPSTORECMBTINDEX)
      if (!raw) return
      let index: CombatStorageIndex
      try { index = parseCombatStorageIndex(raw) } catch { return }
      const liveRecords = new Set(Object.values(index.recordsById))
      try {
        for (const key of Object.values(index.recordsById)) {
          const manifest = scenarioManifest(key)
          if (!manifest) continue
          for (const section of [manifest.targetRecord, manifest.environmentRecord, manifest.programRecord,
            manifest.dormantRecord, ...Object.values(manifest.memberRecords)]) {
            if (section) liveRecords.add(section)
          }
        }
      } catch { return }
      for (let cursor = localStorage.length - 1; cursor >= 0; cursor -= 1) {
        const key = localStorage.key(cursor)
        if (key?.startsWith(APPSTORECMBTREC) && !liveRecords.has(key)) localStorage.removeItem(key)
      }
    }, 5_000)
    ;(this.cleanupTimer as unknown as { unref?: () => void }).unref?.()
  }

  hasCurrentManifest(): boolean {
    return this.lastManifest != null && this.lastManifest === localStorage.getItem(APPSTORECMBTINDEX)
  }

  rememberWorkspaceRefs(combat: PersistedState['combat']): void {
    this.savedRefs.clear()
    for (const id of combat.order) {
      const descriptor = Object.getOwnPropertyDescriptor(combat.scenariosById, id)
      if (descriptor && 'value' in descriptor) this.savedRefs.set(id, descriptor.value)
    }
  }

  readWorkspace(): Pick<PersistedState, 'version' | 'combat'> | null {
    const raw = localStorage.getItem(APPSTORECMBTINDEX)
    if (!raw) return null
    try {
      const index = parseCombatStorageIndex(raw)
      if (!index.summaryById) {
        // migrate an older index one record at a time. a complete workspace
        // validation used to hold all decoded scenarios at once during startup.
        index.summaryById = Object.fromEntries(index.order.map((id) => [
          id, summarizeScenario(readScenarioRecord(id, index.recordsById[id])),
        ]))
        const upgraded = JSON.stringify(index)
        try {
          localStorage.setItem(APPSTORECMBTINDEX, upgraded)
          this.lastManifest = upgraded
        } catch {
          this.lastManifest = raw
        }
      } else {
        this.lastManifest = raw
      }
      const records = makeLazyScenarioRecords(index)
      // validate the selected record eagerly. other records are parsed only
      // when their scenario is selected, copied, or exported.
      const selectedScenario = records[index.selectedScenarioId]
      this.savedRefs.clear()
      this.savedRefs.set(index.selectedScenarioId, selectedScenario)
      this.scheduleCleanup()
      return {
        version: APP_STATE_VER,
        combat: {
          selectedScenarioId: index.selectedScenarioId,
          order: index.order,
          scenariosById: records,
          summaryById: index.summaryById,
        },
      } as Pick<PersistedState, 'version' | 'combat'>
    } catch (error) {
      console.warn('[storage] failed to load scenario records', error)
      this.lastManifest = null
      this.savedRefs.clear()
      return null
    }
  }


  writeWorkspace(combat: PersistedState['combat']): void {
    const oldRaw = localStorage.getItem(APPSTORECMBTINDEX)
    let oldIndex: CombatStorageIndex | null = null
    try {
      if (oldRaw) oldIndex = parseCombatStorageIndex(oldRaw)
    } catch {
      // a new manifest can recover from a damaged one without reusing its rows.
    }
    if (oldRaw !== this.lastManifest) this.savedRefs.clear()
    // records written before a failed manifest commit are unreachable. reclaim
    // them before migration, while the complete legacy workspace is still safe.
    if (!oldIndex && localStorage.getItem(APPSTORECMBT) != null) {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index)
        if (key?.startsWith(APPSTORECMBTREC)) localStorage.removeItem(key)
      }
    }

    const order = combat.order
    const ids = Object.keys(combat.scenariosById)
    if (order.length === 0
      || new Set(order).size !== order.length
      || !Object.hasOwn(combat.scenariosById, combat.selectedScenarioId)
      || ids.length !== order.length
      || order.some((id) => !Object.hasOwn(combat.scenariosById, id))) {
      throw new Error('Refusing to save invalid combat workspace index.')
    }

    const recordsById: Record<string, string> = {}
    const summaryById: Record<string, ScenarioSummary> = {}
    const resonatorIdsById: Record<string, string[]> = {}
    const createdKeys: string[] = []
    const retiredKeys: string[] = []
    try {
      for (const id of order) {
        const previousKey = oldIndex?.recordsById[id]
        const descriptor = Object.getOwnPropertyDescriptor(combat.scenariosById, id)
        const getterKey = (descriptor?.get as StoredScenarioGetter | undefined)?.recordKey
        if (previousKey && getterKey === previousKey && oldRaw === this.lastManifest) {
          recordsById[id] = previousKey
          resonatorIdsById[id] = oldIndex?.resonatorIdsById?.[id] ?? readStoredScenarioIds(previousKey)
          summaryById[id] = oldIndex?.summaryById?.[id]
            ?? combat.summaryById?.[id]
            ?? summarizeScenario(combat.scenariosById[id])
          continue
        }
        const scenario = combat.scenariosById[id]
        if (previousKey && this.savedRefs.get(id) === scenario) {
          recordsById[id] = previousKey
          resonatorIdsById[id] = oldIndex?.resonatorIdsById?.[id]
            ?? scenario.team.members.map((member) => member.resonatorId)
          summaryById[id] = combat.summaryById?.[id] ?? summarizeScenario(scenario)
          continue
        }
        const previousScenario = this.savedRefs.get(id)
        const previousManifest = previousKey ? scenarioManifest(previousKey) : null
        const validated = validateScenarioForWrite(id, scenario, previousScenario, previousManifest)
        const memberRecords: Record<string, string> = {}
        for (const member of validated.team.members) {
          const oldMember = previousScenario?.team.members.find((candidate) => candidate.id === member.id)
          const currentMember = scenario.team.members.find((candidate) => candidate.id === member.id)
          memberRecords[member.id] = oldMember === currentMember && previousManifest?.memberRecords[member.id]
            ? previousManifest.memberRecords[member.id]
            : this.writeRecord(id, `member-${encodeURIComponent(member.id)}`, member, createdKeys)
        }
        const targetRecord = previousScenario?.target === scenario.target && previousManifest?.targetRecord
          ? previousManifest.targetRecord : this.writeRecord(id, 'target', validated.target, createdKeys)
        const environmentRecord = previousScenario?.environment === scenario.environment && previousManifest?.environmentRecord
          ? previousManifest.environmentRecord : this.writeRecord(id, 'environment', validated.environment, createdKeys)
        // compact sequences are derived from the catalog when projected. old
        // advanced content remains on disk until the saved-rotation migration
        // archives it, so a routine workspace save cannot erase that content.
        const resonatorId = contextScenarioMember(validated).resonatorId
        const legacyAdvancedSequence = validated.program.sequence.length > 0
          && !isRotationSequence(validated.program.sequence, resonatorId)
        const previousProgram = previousManifest?.programRecord
          ? decodeCombatRecord(previousManifest.programRecord) as Record<string, unknown>
          : null
        const previousStoredLegacySequence = previousProgram
          && Object.hasOwn(previousProgram, 'sequence')
        const reuseProgramRecord = previousScenario?.program === scenario.program
          && previousManifest?.programRecord
          && Boolean(previousStoredLegacySequence) === legacyAdvancedSequence
        const programRecord = reuseProgramRecord
          ? previousManifest.programRecord
          : this.writeRecord(id, 'program', {
            ...(legacyAdvancedSequence ? { sequence: validated.program.sequence } : {}),
            program: validated.program.program,
            lastRanAt: validated.program.lastRanAt,
          }, createdKeys)
        const dormantRecord = scenario.dormantMembersByResonatorId
          ? previousScenario?.dormantMembersByResonatorId === scenario.dormantMembersByResonatorId && previousManifest?.dormantRecord
            ? previousManifest.dormantRecord
            : this.writeRecord(id, 'dormant', validated.dormantMembersByResonatorId, createdKeys)
          : undefined
        const recordKey = this.writeRecord(id, 'manifest', {
          format: 2,
          id,
          revision: validated.revision,
          contextMemberId: validated.contextMemberId,
          initialOnFieldMemberId: validated.initialOnFieldMemberId,
          team: validated.team.members.map((member) => member.resonatorId),
          memberIds: validated.team.members.map((member) => member.id),
          memberRecords,
          targetRecord,
          environmentRecord,
          programRecord,
          ...(dormantRecord ? { dormantRecord } : {}),
        } satisfies ScenarioRecordManifest, createdKeys)
        if (previousKey) retiredKeys.push(previousKey)
        if (previousManifest) {
          const retained = new Set([targetRecord, environmentRecord, programRecord, dormantRecord,
            ...Object.values(memberRecords)])
          for (const key of [previousManifest.targetRecord, previousManifest.environmentRecord,
            previousManifest.programRecord, previousManifest.dormantRecord,
            ...Object.values(previousManifest.memberRecords)]) {
            if (key && !retained.has(key)) retiredKeys.push(key)
          }
        }
        recordsById[id] = recordKey
        resonatorIdsById[id] = validated.team.members.map((member) => member.resonatorId)
        summaryById[id] = summarizeScenario(validated)
      }

      const nextRaw = JSON.stringify({
        version: APP_STATE_VER,
        selectedScenarioId: combat.selectedScenarioId,
        order,
        recordsById,
        summaryById,
        resonatorIdsById,
      } satisfies CombatStorageIndex)
      localStorage.setItem(APPSTORECMBTINDEX, nextRaw)
      this.lastManifest = nextRaw
    } catch (error) {
      for (const key of createdKeys) localStorage.removeItem(key)
      throw error
    }
    let cleanupFailed = false
    for (const key of retiredKeys) {
      try { localStorage.removeItem(key) } catch { cleanupFailed = true }
    }
    this.rememberWorkspaceRefs(combat)
    if (cleanupFailed) this.scheduleCleanup()
    localStorage.removeItem(APPSTORECMBT)
  }
}

export const scenarioRecords = new ScenarioRecordRepository()

interface CombatStorageIndex {
  version: number
  selectedScenarioId: CombatScenarioId
  order: CombatScenarioId[]
  recordsById: Record<string, string>
  summaryById?: Record<string, ScenarioSummary>
  resonatorIdsById?: Record<string, string[]>
}

interface ScenarioRecordManifest {
  format: 2
  id: CombatScenarioId
  revision: number
  contextMemberId: CombatScenario['contextMemberId']
  initialOnFieldMemberId: CombatScenario['initialOnFieldMemberId']
  team: string[]
  memberIds: string[]
  memberRecords: Record<string, string>
  targetRecord: string
  environmentRecord: string
  programRecord: string
  dormantRecord?: string
}

function decodeCombatRecord(key: string): unknown {
  const record = localStorage.getItem(key)
  if (!record) throw new Error(`Missing combat scenario record: ${key}`)
  const json = record.startsWith(COMPRESSED_ROTATIONS_PREFIX)
    ? decompressFromUTF16(record.slice(COMPRESSED_ROTATIONS_PREFIX.length))
    : record
  if (!json) throw new Error(`Unreadable combat scenario record: ${key}`)
  return JSON.parse(json)
}

function scenarioManifest(key: string): ScenarioRecordManifest | null {
  const value = decodeCombatRecord(key) as Partial<ScenarioRecordManifest> | null
  if (!value || value.format !== 2) return null
  if (!Array.isArray(value.memberIds) || !value.memberRecords
    || !value.targetRecord || !value.environmentRecord || !value.programRecord) {
    throw new Error(`Invalid combat scenario manifest: ${key}`)
  }
  return value as ScenarioRecordManifest
}

function parseCombatStorageIndex(raw: string): CombatStorageIndex {
  const index = JSON.parse(raw) as CombatStorageIndex
  if (index?.version !== APP_STATE_VER
    || typeof index.selectedScenarioId !== 'string'
    || !Array.isArray(index.order)
    || !index.recordsById
    || typeof index.recordsById !== 'object'
    || index.order.length === 0
    || new Set(index.order).size !== index.order.length
    || !index.order.includes(index.selectedScenarioId)
    || Object.keys(index.recordsById).length !== index.order.length
    || (index.summaryById != null && (
      Object.keys(index.summaryById).length !== index.order.length
      || index.order.some((id) => {
        const summary = index.summaryById?.[id]
        return !summary
          || typeof summary.resonatorId !== 'string'
          || !Number.isFinite(summary.level)
          || !Number.isFinite(summary.sequence)
          || !Number.isFinite(summary.rotationNodes)
      })
    ))
    || (index.resonatorIdsById != null && (
      Object.keys(index.resonatorIdsById).length !== index.order.length
      || index.order.some((id) => !Array.isArray(index.resonatorIdsById?.[id])
        || index.resonatorIdsById![id].some((resonatorId) => typeof resonatorId !== 'string'))
    ))
    || index.order.some((id) => typeof id !== 'string'
      || typeof index.recordsById[id] !== 'string'
      || !index.recordsById[id].startsWith(APPSTORECMBTREC))) {
    throw new Error('Combat workspace index is invalid.')
  }
  return index
}

type StoredScenarioGetter = (() => CombatScenario) & { recordKey?: string }

function readScenarioRecord(id: string, recordKey: string): CombatScenario {
  const record = decodeCombatRecord(recordKey) as Partial<ScenarioRecordManifest> & { id?: unknown }
  const parsed = record?.format === 2
    ? {
      id: record.id,
      revision: record.revision,
      contextMemberId: record.contextMemberId,
      initialOnFieldMemberId: record.initialOnFieldMemberId,
      team: { members: record.memberIds!.map((memberId) => decodeCombatRecord(record.memberRecords![memberId])) },
      target: decodeCombatRecord(record.targetRecord!),
      environment: decodeCombatRecord(record.environmentRecord!),
      program: decodeCombatRecord(record.programRecord!),
      ...(record.dormantRecord ? { dormantMembersByResonatorId: decodeCombatRecord(record.dormantRecord) } : {}),
    }
    : record
  if (!parsed || parsed.id !== id) throw new Error(`Invalid combat scenario record: ${id}`)
  const result = parseCombatScenario(parsed)
  if (!result.success) throw new Error(`Invalid combat scenario record: ${id}`)
  // normalize one record when it is actually read; this restores catalog
  // derived weapon fields without expanding every saved scenario at startup.
  return normalizeStoredCombatScenario(result.data as unknown as CombatScenario)
}

function makeLazyScenarioRecords(index: CombatStorageIndex): Record<string, CombatScenario> {
  const records: Record<string, CombatScenario> = {}
  for (const id of index.order) {
    const key = index.recordsById[id]
    let cached: CombatScenario | null = null
    const get = (() => {
      cached ??= readScenarioRecord(id, key)
      return cached
    }) as StoredScenarioGetter
    get.recordKey = key
    Object.defineProperty(records, id, { enumerable: true, configurable: true, get })
  }
  return records
}

export function readCombatWorkspace(): Pick<PersistedState, 'version' | 'combat'> | null {
  return scenarioRecords.readWorkspace()
}

function validateScenarioForWrite(
  id: CombatScenarioId,
  scenario: CombatScenario,
  previous: CombatScenario | undefined,
  previousManifest: ScenarioRecordManifest | null,
): CombatScenario {
  const fullParse = () => {
    const parsed = parseCombatScenario(scenario)
    if (!parsed.success || parsed.data.id !== id) throw new Error(`Refusing to save invalid combat scenario: ${id}`)
    return parsed.data as unknown as CombatScenario
  }
  if (!previous || !previousManifest) return fullParse()

  // this path only trusts section references that were validated at the last
  // successful manifest commit. new sections still go through their schemas.
  const allowed = new Set(['id', 'revision', 'team', 'contextMemberId', 'initialOnFieldMemberId',
    'dormantMembersByResonatorId', 'target', 'environment', 'program'])
  const members = scenario.team?.members
  if (scenario.id !== id || !Number.isInteger(scenario.revision) || scenario.revision < 0
    || Object.keys(scenario).some((key) => !allowed.has(key))
    || Object.keys(scenario.team ?? {}).some((key) => key !== 'members')
    || !Array.isArray(members) || members.length < 1 || members.length > 3) {
    throw new Error(`Refusing to save invalid combat scenario: ${id}`)
  }
  const requireValid = <T>(result: { success: boolean; data?: unknown }, label: string): T => {
    if (!result.success) throw new Error(`Refusing to save invalid ${label} in combat scenario: ${id}`)
    return result.data as T
  }
  const validatedMembers = members.map((member) => {
    const old = previous.team.members.find((candidate) => candidate.id === member.id)
    return old === member ? member
      : requireValid<CombatScenario['team']['members'][number]>(parseScenarioMember(member), 'member')
  })
  const memberIds = new Set<string>(validatedMembers.map((member) => member.id))
  const resonatorIds = new Set(validatedMembers.map((member) => member.resonatorId))
  if (memberIds.size !== validatedMembers.length || resonatorIds.size !== validatedMembers.length
    || !memberIds.has(scenario.contextMemberId) || !memberIds.has(scenario.initialOnFieldMemberId)) {
    throw new Error(`Refusing to save invalid combat scenario members: ${id}`)
  }
  const environment = previous.environment === scenario.environment ? scenario.environment
    : requireValid<CombatScenario['environment']>(parseScenarioEnvironment(scenario.environment), 'environment')
  for (const [sourceId, routes] of Object.entries(environment.routing.bySourceMemberId)) {
    if (!memberIds.has(sourceId) || Object.values(routes).some((targetId) => targetId !== null && !memberIds.has(targetId))) {
      throw new Error(`Refusing to save invalid combat scenario routing: ${id}`)
    }
  }
  if (environment.manualEffects.some((effect) => effect.selector.kind === 'members'
    && effect.selector.memberIds.some((memberId) => !memberIds.has(memberId)))) {
    throw new Error(`Refusing to save invalid combat scenario effects: ${id}`)
  }
  const target = previous.target === scenario.target ? scenario.target
    : requireValid<CombatScenario['target']>(parseScenarioTarget(scenario.target), 'target')
  const program = previous.program === scenario.program ? scenario.program
    : requireValid<CombatScenario['program']>(parseScenarioProgram(scenario.program), 'program')
  const dormantMembersByResonatorId = previous.dormantMembersByResonatorId === scenario.dormantMembersByResonatorId
    ? scenario.dormantMembersByResonatorId
    : scenario.dormantMembersByResonatorId
      ? requireValid<NonNullable<CombatScenario['dormantMembersByResonatorId']>>(
        parseDormantScenarioMembers(scenario.dormantMembersByResonatorId), 'dormant members')
      : undefined
  return {
    ...scenario,
    team: makeScenarioTeam(validatedMembers),
    target,
    environment,
    program,
    ...(dormantMembersByResonatorId ? { dormantMembersByResonatorId } : {}),
  }
}

export function writeCombatWorkspace(combat: PersistedState['combat']): void {
  scenarioRecords.writeWorkspace(combat)
}
