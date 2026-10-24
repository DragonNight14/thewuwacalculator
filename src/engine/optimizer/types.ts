/*
  Author: Runor Ewhro
  description: defines optimizer payloads, execution shapes, result
               records, and packed context structures shared across
               CPU/GPU optimizer flows.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { EchoDef } from '@/domain/entities/catalog'
import type { GameDataReg } from '@/domain/gameData/contracts'
import type { RotationNode } from '@/domain/gameData/contracts'
import type { OptSets } from '@/domain/entities/optimizer'
import type { ResDtls } from '@/domain/entities/resonator'
import type { EchoInstance, ResRuntime, ResSeed } from '@/domain/entities/runtime'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals'
import type { WeaponPlanSet } from '@/domain/entities/suggestions'
import type { FinalStats, ResBaseStats, SkillDef } from '@/domain/entities/stats'
import type { GenWpn } from '@/domain/entities/weapon'
import type { GameDataMode } from '@/domain/entities/gameDataMode'
import type { SetDef } from '@/data/gameData/echoSets/effects'
import type { EchoSttsCatD } from '@/data/gameData/catalog/echoStats'
import type { OptResultStats } from '@/engine/search/score/core.ts'
import type { CompTargetSkill } from '@/engine/search/context/compiled.ts'

// lifecycle states for an optimizer run
export type OptStts = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

// backend chosen to execute the optimizer
export type OptBckn = 'cpu' | 'gpu'

// optimizer phase the progress snapshot is currently describing. theory mode
// runs a discovery phase (the producer iterates through the row space) before workers
// begin evaluating; non-theory modes go straight to evaluation.
export type OptPrgrPh = 'discovering' | 'evaluating'

// progress snapshot exposed while optimization is running
export interface OptPrgr {
  progress: number
  elapsedMs: number
  remainingMs: number
  processed: number
  speed: number
  total?: number
  phase?: OptPrgrPh
  discovered?: number
}

// one resolved optimizer result, usually storing selected echo ids plus damage
export interface OptResultEntry {
  uids: string[]
  damage: number
  stats: OptResultStats | null
}

// materialized theoretical result, built from compact recipe rows only when needed
export interface TheoryResult {
  uids: string[]
  echoes: EchoInstance[]
  damage: number
  stats: OptResultStats | null
  // catalog id of the best weapon for this build when weapon search was active,
  // else null. surfaced as the weapon result column (like the main echo).
  weaponId?: string | null
}

/** a run shares candidates; only the selected loadout is copied for editing. */
export interface CompactTheoryResult {
  theory: { candidates: EchoInstance[] }
  indices: number[]
  mainSlot: number
  damage: number
  stats: OptResultStats | null
  weaponId?: string | null
}

// bag-style result reference that stores echo indices.
export interface OptBagResult {
  damage: number
  i0: number
  i1: number
  i2: number
  i3: number
  i4: number
  // index into the run's weapon-overlay list for the best weapon found for this
  // build, or -1/undefined when weapon search was not active.
  weapon?: number
}

// theoretical result reference that stores the generated echo recipe compactly
export interface TheoryResultRow {
  damage: number
  ids: string[]
  sets: number[]
  mains: string[]
  main: number
  stats: OptResultStats | null
}

export type OptRawResult =
    | OptBagResult
    | TheoryResultRow

export type OptStoredResult = OptFinalResult | CompactTheoryResult

export type OptFinalResult =
    | OptResultEntry
    | TheoryResult

// typed aliases used by the packed optimizer buffers
export type CostArray = Uint8Array
export type SetArray = Uint8Array
export type KindArray = Uint16Array

// shared payload fields used by both target-skill and rotation optimizer runs
// these keys are internal worker contract fields, so compact names keep hot
// payload plumbing readable without touching persisted optimizer settings.
export interface PrepOptShrdP {
  scenarioId: import('@/domain/entities/combatScenario').CombatScenarioId
  memberId: import('@/domain/entities/combatScenario').TeamMemberId
  resultsLimit: number
  lowMmryMode: boolean
  constraints: Float32Array
  costs: CostArray
  sets: SetArray
  kinds: KindArray
  comboN: number
  comboK: number
  totalCombos: number
  comboIndexMap: Int32Array
  comboBinom: Uint32Array
  lockMainReq: boolean
  lockMainCands: Int32Array
  progFact: number

  // weapon search (optional). when present, evaluation scores each build against
  // every weapon overlay and keeps the best, tagging the result with its index.
  // weaponOverlays: weaponCount × WEAPON_OVERLAY_STRIDE floats (base ⊕ overlay).
  // weaponIds: catalog id per overlay row, parallel to the overlays.
  weaponOverlays?: Float32Array
  weaponCount?: number
  weaponIds?: string[]
}

// high-level compilation request before numeric packing. catalog snapshots
// remain transient; the supplied scenario/runtime stores saved configuration.
export interface OptStartPay {
  scenarioId: import('@/domain/entities/combatScenario').CombatScenarioId
  memberId: import('@/domain/entities/combatScenario').TeamMemberId
  resonatorId: string
  gameDataMode?: GameDataMode
  /** candidate catalog scope resolved before crossing the worker boundary. */
  weaponDataIds?: string[]
  resSeed?: ResSeed
  staticData?: {
    gameDataReg: GameDataReg
    resCatById: Record<string, ResSeed>
    resDtlsById: Record<string, ResDtls>
    weaponsById: Record<string, GenWpn>
    echoCatById: Record<string, EchoDef>
    echoSetDefs: SetDef[]
    echoStats?: EchoSttsCatD
  }
  runtime: ResRuntime
  /** canonical participant runtimes; detached legacy callers may omit this. */
  runtimesById?: Record<string, ResRuntime>
  settings: OptSets
  invChs: EchoInstance[]
  enemyProfile: EnemyProfile
  selectedTargets?: Record<string, string | null>
  combatSetup?: import('@/engine/pipeline/index.ts').RotationCombatSetup
  setConds?: SntSetConds
  rotTms?: RotationNode[] | null
  // global weapon-search plan (rarity visibility + ranks). when present, theory
  // weapon search restricts candidates to visible rarities at the configured
  // ranks, mirroring weapon suggestions. absent -> the built-in 4★/5★ defaults.
  weaponPlan?: WeaponPlanSet
}

// prepared target-skill optimizer run before final packed execution handoff
export interface PrepTargetSkill extends PrepOptShrdP {
  mode: 'targetSkill'
  runtime: ResRuntime
  skill: SkillDef
  selectedSkill: {
    id: string
    label: string
    tab: string
    element: SkillDef['element']
    skillType: SkillDef['skillType']
    archetype: SkillDef['archetype']
  }
  sourceBaseStats: ResBaseStats
  sourceFinals: FinalStats
  compiled: CompTargetSkill
  setRtMask: number
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
}

// final packed target-skill payload sent into the execution layer
export interface PackedSkill extends PrepOptShrdP {
  mode: 'targetSkill'
  context: Float32Array
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
}

// prepared rotation optimizer run containing multiple packed contexts
// and one display context used for presenting representative stats/results.
export interface PrepRotRun extends PrepOptShrdP {
  rotationProgram: import('@/engine/rotation/portable/compiler').PortableRotationProgram
  weaponPrograms?: import('@/engine/rotation/portable/compiler').PortableRotationProgram[]
  mode: 'rotation'
  gameDataMode?: GameDataMode
  staticData?: OptStartPay['staticData']
  fixedTeamDamage: number
  candidateEchoes?: EchoInstance[]
  runtime: ResRuntime
  sourceBaseStats: ResBaseStats
  sourceFinals: FinalStats
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
}

export interface ThryProf {
  uid: string
  substats: Record<string, number>
}

export interface ThryEchoCt {
  id: string
  cost: number
  sets: number[]
  // true when the catalog echo includes at least one effect with
  // `targetScope: 'self'` (or implicit default). only self-buff cats are
  // eligible to serve as the main echo in theory search.
  hasSelfBff: boolean
}

export interface TheoryRow {
  slot: number
  id: string | null
  ids: string[]
  set: number
  main: string
  cost: number
  mainOk: boolean
}

// prepared target-skill theory run with fixed substat profiles and catalog rows
export interface PrepTheoryTarget extends PrepOptShrdP {
  mode: 'theoryTarget'
  gameDataMode?: GameDataMode
  staticData?: OptStartPay['staticData']
  theoryTotal: number
  runtime: ResRuntime
  skill: SkillDef
  selectedSkill: PrepTargetSkill['selectedSkill']
  sourceBaseStats: ResBaseStats
  sourceFinals: FinalStats
  compiled: CompTargetSkill
  setRtMask: number
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
  profs: ThryProf[]
  cats: ThryEchoCt[]
  theoryRows: TheoryRow[]
  mainFltr: string[]
  selBonus: string | null
}

// prepared rotation theory run with the same display/evaluation context shape
export interface PrepTheoryRot extends PrepOptShrdP {
  rotationProgram: import('@/engine/rotation/portable/compiler').PortableRotationProgram
  weaponPrograms?: import('@/engine/rotation/portable/compiler').PortableRotationProgram[]
  mode: 'theoryRotation'
  fixedTeamDamage: number
  candidateEchoes?: EchoInstance[]
  gameDataMode?: GameDataMode
  staticData?: OptStartPay['staticData']
  theoryTotal: number
  runtime: ResRuntime
  sourceBaseStats: ResBaseStats
  sourceFinals: FinalStats
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
  profs: ThryProf[]
  cats: ThryEchoCt[]
  theoryRows: TheoryRow[]
  mainFltr: string[]
  selBonus: string | null
}

// final packed rotation payload sent into the execution layer
export interface PckdRotXctnP extends PrepOptShrdP {
  rotationProgram: import('@/engine/rotation/portable/compiler').PortableRotationProgram
  weaponPrograms?: import('@/engine/rotation/portable/compiler').PortableRotationProgram[]
  mode: 'rotation'
  gameDataMode?: GameDataMode
  staticData?: OptStartPay['staticData']
  fixedTeamDamage: number
  candidateEchoes?: EchoInstance[]
  stats: Float32Array
  setConstLut: Float32Array
  mainEchoBuffs: Float32Array
}

// union of all prepared optimizer payload shapes
export type PrepOptPay =
    | PrepTargetSkill
    | PrepRotRun
    | PrepTheoryTarget
    | PrepTheoryRot

// union of all packed execution payload shapes
export type PckdOptXctnP =
    | PackedSkill
    | PckdRotXctnP
