/*
  Author: Runor Ewhro
  description: scores target optimizer candidates from packed Echo and set rows.
*/

// cost-legal combo layout, packed by combos/costLayout.ts:
// [0] = (groupCount, segmentCount, comboK, 0), [1] = group starts,
// [2] = group sizes, [3 + s] = (segment start rank, 4-bit pick counts, size, 0)
@group(0) @binding(12) var<uniform> costLayout: array<vec4<u32>, 64>;

// inventory frames append only candidates at or above params.candidateFloor
// behind an atomic count; theory batches write items[idx] directly. tiles
// one keep bit per scoring workgroup, set by the bound entry point.
const TILE_WORDS: u32 = __OPT_TARGET_TILE_WORDS__u;
struct CandidateOut {
  count : atomic<u32>,
  _pad  : u32,
  tiles : array<atomic<u32>, TILE_WORDS>,
  items : array<Candidate>,
};
@group(0) @binding(9) var<storage, read_write> candidates: CandidateOut;

@group(0) @binding(4)
var<uniform> params : Params;

struct ComboEval {
    // best damage for this combo
    dmg: f32,

    // which combo position was chosen as main
    mainPos: u32,
};

// inventory index-map entries encode the Echo main-bonus class above bit 16.
// echoes in one class have identical main-echo rows; NO_MAIN_CLASS never matches.
const NO_MAIN_CLASS: u32 = 63u;
const ALL_NO_MAIN_CLASS: u32 = 0x3fffffffu;

fn comboMainClasses(combo: array<u32, 5>) -> u32 {
    var packed = ALL_NO_MAIN_CLASS;
    // a locked main is the only candidate, so there is nothing to share
    if (decodeLockedIndex(params) >= 0) { return packed; }
    let comboK = decodeComboK(params);
    for (var pos: u32 = 0u; pos < comboK; pos = pos + 1u) {
        let cls = (u32(comboIndexMap[combo[pos]]) >> 16u) & NO_MAIN_CLASS;
        packed = (packed & ~(NO_MAIN_CLASS << (pos * 6u))) | (cls << (pos * 6u));
    }
    return packed;
}

// evaluate one exact 5-echo combo and choose its best valid main position
fn computeDamageForEchoIds(echoIds: array<i32, 5>, mainClasses: u32) -> ComboEval {
    let skillId: u32 = unpackSkillIdFromParams();
    let skillMask: u32 = skillMaskFromSkillId(skillId);
    let elementId: u32 = elementFromSkillId(skillId);
    let setRuntimeMask: u32 = decodeSetRuntimeMask(params);
    let lockedIndex: i32 = decodeLockedIndex(params);

    let base = buildEchoBase(echoIds);
    if (base.totalCost > decodeComboMaxCost(params)) {
        return ComboEval(0.0, 0u);
    }

    let sonata = applySetEffects(base, skillMask, setRuntimeMask);
    let pre = buildPreMain(params, sonata, skillMask, elementId);

    var best: f32 = 0.0;
    var bestMain: u32 = 0u;
    let batchMainFirst = decodeComboMode(params) == COMBO_MODE_BATCH;

    for (var mainPos: u32 = 0u; mainPos < 5u; mainPos = mainPos + 1u) {
        if (batchMainFirst && mainPos != 0u) { continue; }
        let mainId = echoIds[mainPos];
        if (mainId < 0) { continue; }
        if (lockedIndex >= 0 && mainId != lockedIndex) { continue; }

        // an earlier position with the same main-bonus row already scored this main
        let cls = (mainClasses >> (mainPos * 6u)) & NO_MAIN_CLASS;
        var repeated = false;
        for (var q: u32 = 0u; q < mainPos; q = q + 1u) {
            if (cls != NO_MAIN_CLASS && ((mainClasses >> (q * 6u)) & NO_MAIN_CLASS) == cls) { repeated = true; }
        }
        if (repeated) { continue; }

        let avg = evalMainEcho(pre, base, setRuntimeMask, u32(mainId));

        if (avg > best) {
            best = avg;
            bestMain = mainPos;
        }
    }

    return ComboEval(best, bestMain);
}

fn computeDamageForCombo(index: u32) -> ComboEval {
    let comboCount = decodeComboCount(params);
    if (index >= comboCount) {
        return ComboEval(0.0, 0u);
    }

    let comboIndex = comboBaseIndex(params) + index;
    let echoIds = buildEchoIds(comboIndex);
    return computeDamageForEchoIds(echoIds, ALL_NO_MAIN_CLASS);
}

@compute @workgroup_size(__OPT_TARGET_WORKGROUP_SIZE__)
fn main(
    @builtin(workgroup_id) wg: vec3<u32>,
    @builtin(local_invocation_id) lid3: vec3<u32>
) {
    let lid = lid3.x;
    let comboCount = decodeComboCount(params);

    // dispatchWorkgroupBase lets the cpu split one big job into several submits
    let globalWorkgroup = decodeDispatchWorkgroupBase(params) + wg.x;
    let batchMode = decodeComboMode(params) == COMBO_MODE_BATCH;
    let laneIndex = globalWorkgroup * __OPT_TARGET_WORKGROUP_SIZE__u + lid;
    let comboK = decodeComboK(params);

    let baseIndex = laneIndex * CYCLES_PER_INVOCATION;

    // the bound pass found nothing in this workgroup's tile that reaches the floor
    if (!batchMode && globalWorkgroup < TILE_WORDS * 32u &&
        (atomicLoad(&candidates.tiles[globalWorkgroup / 32u]) & (1u << (globalWorkgroup % 32u))) == 0u) {
        return;
    }

    if (baseIndex < comboCount) {
        var idx: u32 = baseIndex;
        var cursor: CostCursor;
        if (!batchMode) {
            cursor = costCursorAt(comboBaseIndex(params) + idx);
        }

        for (var j: u32 = 0u; j < CYCLES_PER_INVOCATION; j = j + 1u) {
            if (idx >= comboCount) { break; }

            var echoIds: array<i32, 5>;
            var mainClasses = ALL_NO_MAIN_CLASS;
            if (batchMode) {
                echoIds = buildEchoIds(comboBaseIndex(params) + idx);
            } else {
                echoIds = comboIndicesToEchoIds(cursor.combo);
                mainClasses = comboMainClasses(cursor.combo);
            }
            let eval = computeDamageForEchoIds(echoIds, mainClasses);
            let packedIdx = ((eval.mainPos & 7u) << 29u) | idx;
            if (batchMode) {
                candidates.items[idx] = Candidate(max(eval.dmg, 0.0), packedIdx);
            } else if (eval.dmg > 0.0 && eval.dmg >= params.candidateFloor) {
                let slot = atomicAdd(&candidates.count, 1u);
                candidates.items[slot] = Candidate(eval.dmg, packedIdx);
            }

            idx = idx + 1u;
            if (j + 1u >= CYCLES_PER_INVOCATION || idx >= comboCount) { break; }

            if (batchMode) { continue; }

            // advance to the next cost-legal combination without re-unranking
            advanceCostCursor(&cursor, comboK);
        }
    }

}

// tile pruning. a tile is the WORKGROUP_SIZE * CYCLES combos one scoring
// workgroup walks; bound() runs first in the same pass and sets the keep bit
// of every tile that can reach the floor. this is exact only while damage
// never falls when a stat, set piece or main bonus rises.
// the tables (gpu/targetBound.ts) follow the echo stat rows in echoStats:
// BOUND_SET_ROWS vec4s of new-set bonus per free-slot count, then per
// index-map position the max echo stat row and main-echo row over the rest
// of its cost group.
const BOUND_SET_ROWS: u32 = 36u;
const BOUND_SET_VEC4S: u32 = 6u;
const BOUND_MAIN_VEC4S: u32 = (__OPT_MAIN_BUFF_LEN__u + 3u) / 4u;
const BOUND_POS_VEC4S: u32 = STATS_VEC4S_PER_ECHO + BOUND_MAIN_VEC4S;

fn boundData(index: u32) -> vec4<f32> {
    // the locked main is the one echo the index map leaves out
    let echoes = decodeComboN(params) + u32(decodeLockedIndex(params) >= 0);
    return echoStats[echoes * STATS_VEC4S_PER_ECHO + index];
}

fn boundMainField(row: array<vec4<f32>, BOUND_MAIN_VEC4S>, field: u32) -> f32 {
    return row[field / 4u][field % 4u];
}

// upper bound on every combo of first's segment that shares first's positions
// below fixedK and includes at least first's slot at fixedK. each later position
// takes the per-stat max over the slots it can still reach and may add a piece
// to any set, including sets the fixed echoes do not hold.
fn rangeBound(first: CostCursor, fixedK: u32) -> f32 {
    let comboK = decodeComboK(params);
    var ids = array<i32, 5>(-1, -1, -1, -1, -1);
    for (var p: u32 = 0u; p < fixedK; p = p + 1u) {
        ids[p] = comboIndexMap[first.combo[p]] & 0xffff;
    }
    let lockedIndex = decodeLockedIndex(params);
    if (lockedIndex >= 0 && comboK < 5u) { ids[4] = lockedIndex; }

    // a free position in the first differing group starts above the first
    // combo's slot there; one in a later group can take any of its slots
    var rows: array<vec4<f32>, STATS_VEC4S_PER_ECHO>;
    var mainRow: array<vec4<f32>, BOUND_MAIN_VEC4S>;
    let fixedGroup = posGroupOf(first, min(fixedK, 4u));
    for (var p: u32 = fixedK; p < comboK; p = p + 1u) {
        let g = posGroupOf(first, p);
        var lo = costLayout[1u][g];
        if (g == fixedGroup) { lo = first.combo[fixedK] + (p - fixedK); }
        let at = BOUND_SET_ROWS + lo * BOUND_POS_VEC4S;
        for (var v: u32 = 0u; v < STATS_VEC4S_PER_ECHO; v = v + 1u) {
            rows[v] += boundData(at + v);
        }
        for (var v: u32 = 0u; v < BOUND_MAIN_VEC4S; v = v + 1u) {
            mainRow[v] = max(mainRow[v], boundData(at + STATS_VEC4S_PER_ECHO + v));
        }
    }

    var base = buildEchoBaseFrom(ids, rows);
    let free = comboK - fixedK;
    for (var i: u32 = 0u; i < 5u; i = i + 1u) {
        if (base.setCnt[i] > 0u) { base.setCnt[i] = min(base.setCnt[i] + free, 5u); }
    }
    base.count14 = min(base.count14 + free, 5u);
    base.count22 = min(base.count22 + free, 5u);
    base.count29 = min(base.count29 + free, 5u);
    base.count33 = min(base.count33 + free, 5u);

    let skillId: u32 = unpackSkillIdFromParams();
    let skillMask: u32 = skillMaskFromSkillId(skillId);
    let elementId: u32 = elementFromSkillId(skillId);
    let setRuntimeMask: u32 = decodeSetRuntimeMask(params);
    var sonata = applySetEffects(base, skillMask, setRuntimeMask);

    // the best bonus sets opened only by the free slots can add
    let at = free * BOUND_SET_VEC4S;
    let r0 = boundData(at);
    let r1 = boundData(at + 1u);
    let r2 = boundData(at + 2u);
    let r3 = boundData(at + 3u);
    let r4 = boundData(at + 4u);
    let r5 = boundData(at + 5u);
    sonata.atkP += r0.x; sonata.atkF += r0.y; sonata.hpP += r0.z; sonata.hpF += r0.w;
    sonata.defP += r1.x; sonata.defF += r1.y; sonata.critRate += r1.z; sonata.critDmg += r1.w;
    sonata.er += r2.x; sonata.basic += r2.y; sonata.heavy += r2.z; sonata.skill += r2.w;
    sonata.lib += r3.x; sonata.aero += r3.y; sonata.spectro += r3.z; sonata.fusion += r3.w;
    sonata.glacio += r4.x; sonata.havoc += r4.y; sonata.electro += r4.z; sonata.echoSkill += r4.w;
    sonata.coord += r5.x; sonata.bonusBase += r5.y; sonata.erSetBonus += r5.z;

    let pre = buildPreMain(params, sonata, skillMask, elementId);

    var best: f32 = 0.0;
    for (var mainPos: u32 = 0u; mainPos < 5u; mainPos = mainPos + 1u) {
        let mainId = ids[mainPos];
        if (mainId < 0) { continue; }
        if (lockedIndex >= 0 && mainId != lockedIndex) { continue; }
        best = max(best, evalMainEcho(pre, base, setRuntimeMask, u32(mainId)));
    }

    // any free slot may hold the main echo
    if (free > 0u && lockedIndex < 0) {
        let elemIdx = u32(clamp(pre.elementId, 0.0, 5.0));
        best = max(best, evalMainPos(
            pre,
            base.count14,
            base.count33,
            setRuntimeMask,
            boundMainField(mainRow, __OPT_MAIN_BUFF_atkPercent__u) / 100.0,
            boundMainField(mainRow, __OPT_MAIN_BUFF_atkFlat__u),
            boundMainField(mainRow, __OPT_MAIN_BUFF_energyRegen__u),
            boundMainField(mainRow, __OPT_MAIN_BUFF_aero__u + elemIdx),
            vec4<f32>(
                boundMainField(mainRow, __OPT_MAIN_BUFF_basicAtk__u),
                boundMainField(mainRow, __OPT_MAIN_BUFF_heavyAtk__u),
                boundMainField(mainRow, __OPT_MAIN_BUFF_resonanceSkill__u),
                boundMainField(mainRow, __OPT_MAIN_BUFF_resonanceLiberation__u)
            ),
            vec2<f32>(
                boundMainField(mainRow, __OPT_MAIN_BUFF_echoSkill__u),
                boundMainField(mainRow, __OPT_MAIN_BUFF_coord__u)
            ),
            boundMainField(mainRow, __OPT_MAIN_BUFF_critRate__u),
            boundMainField(mainRow, __OPT_MAIN_BUFF_critDmg__u),
            boundMainField(mainRow, __OPT_MAIN_BUFF_dmgBonus__u)
        ));
    }
    return best;
}

fn comboAfter(a: CostCursor, b: CostCursor, comboK: u32) -> bool {
    for (var p: u32 = 0u; p < comboK; p = p + 1u) {
        if (a.combo[p] != b.combo[p]) { return a.combo[p] > b.combo[p]; }
    }
    return false;
}

// one bound workgroup per tile: thread 0 splits the tile into sub-blocks that
// fix every position but the last BOUND_FREE, then every thread bounds one
// sub-block. past BOUND_SUBBLOCKS - 1 sub-blocks the last entry bounds the
// rest of the tile coarsely. one free position prunes no better (tiles run
// past the sub-block cap) at twice the bound cost; three prunes far less.
const BOUND_SUBBLOCKS: u32 = 64u;
const BOUND_FREE: u32 = 2u;
var<workgroup> boundStarts: array<CostCursor, BOUND_SUBBLOCKS>;
var<workgroup> boundFixed: array<u32, BOUND_SUBBLOCKS>;
var<workgroup> boundCount: u32;

fn planTile(firstRank: u32, lastRank: u32, tile: u32) {
    var cursor = costCursorAt(firstRank);
    let last = costCursorAt(lastRank);
    if (cursor.segment != last.segment) {
        atomicOr(&candidates.tiles[tile / 32u], 1u << (tile % 32u));
        return;
    }

    let comboK = decodeComboK(params);
    var prefixK = comboK;
    for (var p: u32 = 0u; p < comboK; p = p + 1u) {
        if (cursor.combo[p] != last.combo[p]) {
            prefixK = p;
            break;
        }
    }
    if (prefixK + 1u >= comboK) {
        boundStarts[0] = cursor;
        boundFixed[0] = prefixK;
        boundCount = 1u;
        return;
    }

    let tail = max(comboK - BOUND_FREE, prefixK);
    var count: u32 = 0u;
    loop {
        boundStarts[count] = cursor;
        if (count + 1u == BOUND_SUBBLOCKS) {
            boundFixed[count] = prefixK;
            count = count + 1u;
            break;
        }
        boundFixed[count] = tail;
        count = count + 1u;

        // skip to the next prefix: every free position at its final slot, then step
        for (var p: u32 = tail; p < comboK; p = p + 1u) {
            let g = posGroupOf(cursor, p);
            var after: u32 = 0u;
            for (var q: u32 = p + 1u; q < comboK; q = q + 1u) {
                if (posGroupOf(cursor, q) == g) { after = after + 1u; }
            }
            cursor.combo[p] = costLayout[1u][g] + costLayout[2u][g] - 1u - after;
        }
        if (!advanceCostCursor(&cursor, comboK) || cursor.segment != last.segment ||
            comboAfter(cursor, last, comboK)) {
            break;
        }
    }
    boundCount = count;
}

@compute @workgroup_size(BOUND_SUBBLOCKS)
fn bound(
    @builtin(workgroup_id) wg: vec3<u32>,
    @builtin(local_invocation_id) lid3: vec3<u32>
) {
    let tile = wg.x;
    let lid = lid3.x;
    let size = __OPT_TARGET_WORKGROUP_SIZE__u * CYCLES_PER_INVOCATION;
    let comboCount = decodeComboCount(params);
    let first = tile * size;
    let inFrame = first < comboCount && tile < TILE_WORDS * 32u;

    if (lid == 0u) {
        boundCount = 0u;
        if (inFrame) {
            let base = comboBaseIndex(params);
            planTile(base + first, base + min(first + size, comboCount) - 1u, tile);
        }
    }
    let count = workgroupUniformLoad(&boundCount);
    if (lid >= count) { return; }

    // the margin absorbs rounding between the bound and the exact scoring order
    if (rangeBound(boundStarts[lid], boundFixed[lid]) * 1.0001 >= params.candidateFloor) {
        atomicOr(&candidates.tiles[tile / 32u], 1u << (tile % 32u));
    }
}
