/*
  Author: Runor Ewhro
  description: exposes the packed rotation-search payload used by optimizer
               workers and runner paths.
*/

import type {
  PckdRotXctnP,
  PrepRotRun,
  PrepTheoryRot,
} from '@/engine/optimizer/types.ts'

// convert a prepared rotation or theory-rotation run into the execution
// payload consumed by rotation search workers.
export function packRotation(
    prepared: PrepRotRun | PrepTheoryRot,
): PckdRotXctnP {
  const execution = {
    ...prepared,
    mode: 'rotation' as const,
  }
  return shrPckdRotXc(execution)
}

// worker execution uses combo layout, rows, and compiled programs;
// fixed team damage is part of the program and is zeroed in this payload.
export function shrPckdRotXc(
    payload: PckdRotXctnP,
): PckdRotXctnP {
  return {
    mode: 'rotation', scenarioId: payload.scenarioId, memberId: payload.memberId,
    resultsLimit: payload.resultsLimit, lowMmryMode: payload.lowMmryMode,
    constraints: payload.constraints, costs: payload.costs, sets: payload.sets, kinds: payload.kinds,
    comboN: payload.comboN, comboK: payload.comboK, totalCombos: payload.totalCombos,
    comboIndexMap: payload.comboIndexMap, comboBinom: payload.comboBinom,
    lockMainReq: payload.lockMainReq, lockMainCands: payload.lockMainCands, progFact: payload.progFact,
    weaponCount: payload.weaponCount, weaponIds: payload.weaponIds,
    rotationProgram: payload.rotationProgram, weaponPrograms: payload.weaponPrograms,
    fixedTeamDamage: 0,
    stats: payload.stats, setConstLut: payload.setConstLut, mainEchoBuffs: payload.mainEchoBuffs,
  }
}
