/*
  Author: Runor Ewhro
  description: merges portable rotation programs and emits specialized WGSL
               arithmetic for GPU candidate evaluation.
*/

import type { PortablePayload, PortableRotationProgram } from './compiler'
import { arithmeticSource, mergeRotationScalars, mainInvariantInput } from './native'
import { TEAM_INPUT } from './layout'
import { NATIVE_ROTATION_WORKGROUP_SIZE } from '@/engine/search/layout/constants'
export function portablePrograms(payload: PortablePayload): PortableRotationProgram[] {
  return payload.weaponPrograms?.length ? payload.weaponPrograms : [payload.rotationProgram]
}

/** the only program data read by the shader is the per-weapon catalog symbol
 * map. all instructions, constants and register addresses are compiled away. */
export function packPortableGpuPrograms(payload: PortablePayload): Float32Array {
  const programs = portablePrograms(payload), symbols = new Float32Array(programs.length * payload.sets.length)
  programs.forEach((program, index) => symbols.set(program.echoSymbols, index * payload.sets.length))
  return symbols
}

export function portableShader(payload: PortablePayload): string {
  const programs = portablePrograms(payload), symbolBase = TEAM_INPUT.count
  const merged = mergeRotationScalars(programs.map((program) => program.scalar))
  const code = arithmeticSource(merged, {
    language: 'wgsl',
    invariant: mainInvariantInput,
    helperContext: { parameters: ['inputs: ptr<function, PortableArithmeticInputs>'], arguments: ['inputs'] },
    input: (index) => {
      if (index < 100) return `echoStats[u32((*inputs).rows[${Math.floor(index / 20)}]) * 5u + ${Math.floor(index % 20 / 4)}u][${index % 4}u]`
      if (index < TEAM_INPUT.echoIds) return `(*inputs).counts[${index - TEAM_INPUT.setCounts}u]`
      if (index >= TEAM_INPUT.echoSets && index < TEAM_INPUT.mainId) return `echoSets[u32((*inputs).rows[${index - TEAM_INPUT.echoSets}])]`
      if (index === TEAM_INPUT.mainPosition) return '0.0'
      if (index >= TEAM_INPUT.presence && index < TEAM_INPUT.totals) return '1.0'
      if (index === TEAM_INPUT.selfMainEchoEffects) return '1.0'
      if (index >= TEAM_INPUT.totals && index < TEAM_INPUT.selfMainEchoEffects) return `(*inputs).totals[${index - TEAM_INPUT.totals}u]`
      const weapon = Math.floor((index - symbolBase) / 6), slot = (index - symbolBase) % 6
      return `rotationContexts[${weapon * payload.sets.length}u + u32((*inputs).rows[${slot === 5 ? 0 : slot}])]`
    },
  })
  const choices = programs.map((_, weapon) => {
    const out = code.outputs.slice(weapon * 8, (weapon + 1) * 8)
    return `if ((${out[0]} > best.dmg || (${out[0]} > 0.0 && ${out[0]} == best.dmg && ${weapon}u < best.weapon)) && portableRange(${out[1]}, statConstraints.atkRange)
      && portableRange(${out[2]}, statConstraints.hpRange) && portableRange(${out[3]}, statConstraints.defRange)
      && portableRange(${out[4]} / 100.0, statConstraints.critRateRange) && portableRange(${out[5]} / 100.0, statConstraints.critDmgRange)
      && portableRange(${out[6]}, statConstraints.erRange) && portableRange(1.0 + ${out[7]} / 100.0, statConstraints.dmgBonusRange)
      && portableRange(${out[0]}, statConstraints.dmgRange)) { best = ComboEval(${out[0]}, main, ${weapon}u); }`
  }).join('\n')
  return `
struct PortableArithmeticInputs { rows: array<i32, 5>, counts: array<f32, 39>, totals: array<f32, 20>, }
fn portableNan(value: f32) -> bool { return (bitcast<u32>(value) & 0x7fffffffu) > 0x7f800000u; }
fn portableEqual(a: f32, b: f32) -> bool { return bitcast<u32>(a) == bitcast<u32>(b) || (portableNan(a) && portableNan(b)); }
fn portableMin(a: f32, b: f32) -> f32 { return select(min(a, b), a + b, portableNan(a) || portableNan(b)); }
fn portableMax(a: f32, b: f32) -> f32 { return select(max(a, b), a + b, portableNan(a) || portableNan(b)); }
fn portableRound(a: f32) -> f32 { let value = floor(a + 0.5); return select(value, bitcast<f32>(0x80000000u), value == 0.0 && a < 0.0); }
fn portableRange(value: f32, window: vec2<f32>) -> bool { return window.x > window.y || (value >= window.x && value <= window.y); }
${code.helpers}
fn computePortableRotation(echoIds: array<i32, 5>) -> ComboEval {
  var cost = 0.0;
  var arithmetic: PortableArithmeticInputs;
  let inputs = &arithmetic;
  for (var slot = 0u; slot < 5u; slot++) {
    if (echoIds[slot] < 0) { return ComboEval(0.0, 0u, 0u); }
    let row = u32(echoIds[slot]);
    cost += echoCosts[row];
    for (var stat = 0u; stat < 20u; stat++) { arithmetic.totals[stat] += echoStats[row * 5u + stat / 4u][stat % 4u]; }
    var duplicate = false;
    for (var previous = 0u; previous < slot; previous++) {
      let other = u32(echoIds[previous]);
      if (echoSets[other] == echoSets[row] && echoKindIds[other] == echoKindIds[row]) { duplicate = true; }
    }
    if (!duplicate) { arithmetic.counts[u32(echoSets[row])] += 1.0; }
  }
  if (cost > decodeComboMaxCost(params)) { return ComboEval(0.0, 0u, 0u); }
  let locked = decodeLockedIndex(params);
  let mainFirst = decodeComboMode(params) == COMBO_MODE_BATCH;
  var best = ComboEval(0.0, 0u, 0u);
  ${code.prepare}
  for (var main = 0u; main < 5u; main++) {
    if ((mainFirst && main != 0u) || (locked >= 0 && echoIds[main] != locked)) { continue; }
    arithmetic.rows[0] = echoIds[main];
    var next = 1u;
    for (var slot = 0u; slot < 5u; slot++) {
      if (slot != main) { arithmetic.rows[next] = echoIds[slot]; next++; }
    }
    ${code.evaluate}
    ${choices}
  }
  return best;
}
// every cycle appends its own candidate when it reaches the run's floor, so
// increasing cycles cannot discard a combination the collector would keep.
@group(0) @binding(13) var<uniform> costLayout: array<vec4<u32>, 64>;
@compute @workgroup_size(${NATIVE_ROTATION_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let count = decodeComboCount(params);
  let first = (decodeDispatchWorkgroupBase(params) * ${NATIVE_ROTATION_WORKGROUP_SIZE}u + invocation.x) * CYCLES_PER_INVOCATION;
  if (first >= count) { return; }
  let batch = decodeComboMode(params) == COMBO_MODE_BATCH;
  // inventory frames walk cost-legal ranks, unranking once per invocation
  var cursor: CostCursor;
  if (!batch) { cursor = costCursorAt(comboBaseIndex(params) + first); }
  for (var cycle = 0u; cycle < CYCLES_PER_INVOCATION; cycle++) {
    let index = first + cycle;
    if (index >= count) { break; }
    var ids: array<i32, 5>;
    if (batch) { ids = buildEchoIds(index); }
    else { ids = comboIndicesToEchoIds(cursor.combo); }
    let evaluated = computePortableRotation(ids);
    var packed = ((evaluated.mainPos & 7u) << 29u) | index;
    if (batch && rotationMeta.weaponCount > 0u) {
      packed = (evaluated.weapon << WEAPON_INDEX_SHIFT_C) | index;
    }
    if (evaluated.dmg > 0.0 && evaluated.dmg >= params.candidateFloor) {
      candidates.items[atomicAdd(&candidates.count, 1u)] = Candidate(evaluated.dmg, packed);
    }
    if (!batch && cycle + 1u < CYCLES_PER_INVOCATION) { advanceCostCursor(&cursor, decodeComboK(params)); }
  }
}
`
}
