/*
  Author: Runor Ewhro
  description: compiles rotation optimizer payloads around one transferable
               candidate plan without building single-skill compatibility data.
*/
import type { ResRuntime } from '@/domain/entities/runtime'
import { getGameDataMode } from '@/data/gameData'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import type { OptStartPay, PrepRotRun } from '@/engine/optimizer/types'
import { compileRotationCandidates, prepareRotationCandidatePlan } from '@/engine/rotation/candidatePlan'
import { encStatCstrs } from '@/engine/search/score/statConstraints'
import { encEchoRows } from '@/engine/search/encode/echoes'
import { mkShrdPay } from './shared'
import { captureRotationDamagePlan } from '@/engine/rotation/damagePlan'
import { resolveWeaponCandidates, stripWeaponControls, withCandidateWeapon } from '@/engine/optimizer/context/weaponOverlays'

export function compRotRun(input: OptStartPay,
  opts: { weaponSearch?: boolean; baseline?: boolean; teamCandidates?: ResRuntime['build']['echoes'] } = {},
): PrepRotRun {
  const seed = input.resSeed ?? getResSeedBy(input.resonatorId)
  if (!seed) throw new Error(`Missing resonator seed for optimizer id ${input.resonatorId}`)
  const items = input.rotTms ?? input.runtime.rotation.sequence
  const candidates = (opts.teamCandidates ?? input.invChs).filter((echo): echo is NonNullable<typeof echo> => echo != null)
  const constraints = opts.baseline ? new Float32Array(0) : encStatCstrs(input.settings)
  const capture = (runtime: ResRuntime) => captureRotationDamagePlan({ runtime, seed, enemy: input.enemyProfile, items,
    runtimesById: makeRuntimeMap(runtime, input.runtimesById), selectedTargets: input.selectedTargets ?? {},
    combatSetup: input.combatSetup, setConds: input.setConds })
  const captured = capture(input.runtime)
  const compile = (plan: ReturnType<typeof capture>) => compileRotationCandidates(
    prepareRotationCandidatePlan(plan), candidates,
    { echoCount: opts.baseline ? input.invChs.length : 5, lockedMainId: opts.baseline ? null : input.settings.lockedMainEchoId }, constraints)
  const weaponSet = opts.weaponSearch && input.settings.includeWeapons ? resolveWeaponCandidates(input) : null
  const baseRuntime = weaponSet ? stripWeaponControls(captured.runtime) : null
  const weaponPrograms = weaponSet?.candidates.map((weapon) => compile(capture(withCandidateWeapon(baseRuntime!, weapon, weaponSet.level, weaponSet.plan))))
  const rotationProgram = weaponPrograms?.[0] ?? compile(captured)
  const encoded = encEchoRows(input.invChs, { id: `rotation:${seed.id}`, label: 'Rotation', tab: 'rotation', element: 'physical', skillType: [], archetype: 'skillDamage' }, 'self')
  return {
    mode: 'rotation', ...mkShrdPay(encoded, input, constraints, opts.baseline),
    gameDataMode: input.gameDataMode ?? getGameDataMode(), staticData: input.staticData,
    runtime: captured.runtime, sourceBaseStats: captured.activeContext.baseStats, sourceFinals: captured.activeContext.finalStats,
    fixedTeamDamage: captured.fixedTeamDamage, rotationProgram, candidateEchoes: input.invChs,
    weaponPrograms, weaponCount: weaponPrograms?.length, weaponIds: weaponSet?.candidates.map((weapon) => weapon.id),
    stats: encoded.stats, setConstLut: new Float32Array(0), mainEchoBuffs: new Float32Array(0),
  }
}
