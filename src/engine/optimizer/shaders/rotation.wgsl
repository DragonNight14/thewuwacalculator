/*
  Author: Runor Ewhro
  description: provides shared bindings and combo decoding for generated rotation kernels.
*/

// encoded per-echo stat rows, 5 vec4s per echo
@group(0) @binding(0) var<storage, read> echoStats: array<vec4<f32>>;

// set bonus lookup table, indexed by [setId][bucket][statOffset]
@group(0) @binding(1) var<storage, read> setConstLut: array<f32>;

// set id per echo
@group(0) @binding(2) var<storage, read> echoSets: array<f32>;

// combinadic index map that converts combo-local positions to actual echo indices
@group(0) @binding(3) var<storage, read> comboIndexMap: array<i32>;

// echo cost per echo
@group(0) @binding(5) var<storage, read> echoCosts: array<f32>;

// per-echo main-echo bonus rows
@group(0) @binding(6) var<storage, read> mainEchoBuffs: array<f32>;

// one kind id per echo keeps duplicate kinds out of set counts.
@group(0) @binding(8) var<storage, read> echoKindIds: array<i32>;

// combinadic binomial table used for rank/unrank math
@group(0) @binding(10) var<storage, read> comboBinom: array<u32>;

// per-weapon catalog symbol maps read by the generated scorer
@group(0) @binding(11) var<storage, read> rotationContexts: array<f32>;

struct StatConstraints {
    // min/max windows for each tracked output stat
    atkRange      : vec2<f32>,
    hpRange       : vec2<f32>,
    defRange      : vec2<f32>,
    critRateRange : vec2<f32>,
    critDmgRange  : vec2<f32>,
    erRange       : vec2<f32>,
    dmgBonusRange : vec2<f32>,
    dmgRange      : vec2<f32>,
};

@group(0) @binding(7)
var<uniform> statConstraints : StatConstraints;

struct Candidate {
  // candidate damage score
  dmg : f32,

  // packed combo rank + chosen main position
  idx : u32,
};

@group(0) @binding(9) var<storage, read_write> candidates: array<Candidate>;

const COMBO_MODE_BATCH: u32 = 3u;

// weapon search packs the chosen weapon index into the candidate's high bits
// (must match WEAPON_INDEX_SHIFT in search/layout/constants.ts).
const WEAPON_INDEX_SHIFT_C: u32 = 27u;

struct Params {
    // base stats and already-baked final stats from the optimizer context
    baseAtk:      f32,
    baseHp:       f32,
    baseDef:      f32,
    baseER:       f32,

    finalAtk:     f32,
    finalHp:      f32,
    finalDef:     f32,
    _padStats:    f32,

    // stat scaling coefficients for the selected target
    scalingAtk:   f32,
    scalingHp:    f32,
    scalingDef:   f32,
    scalingER:    f32,

    // direct damage formula terms
    multiplier:   f32,
    flatDmg:      f32,

    // enemy multipliers already baked outside the shader
    resMult:      f32,
    defMult:      f32,

    // remaining multiplicative layers
    dmgReductionTotal: f32,
    dmgBonus:     f32,
    dmgAmplify:   f32,
    dmgVuln:      f32,

    // crit stats and special toggle bits
    critRate:     f32,
    critDmg:      f32,
    toggles:      f32,

    // packed metadata
    skillId:      u32,
    meta0:        u32,
    meta1:        u32,
    lockedPacked: u32,
    comboBaseIndex: u32,

    // runtime-dependent flags and dispatch metadata
    setRuntimeMask: u32,
    dispatchWorkgroupBase: u32,
    comboN: u32,
    aux0: f32,
    archetype: f32,
    // lowest damage that can still reach the run's top-k
    candidateFloor: f32,
    _pad6: f32,
    _pad7: f32,
};

@group(0) @binding(4)
var<uniform> params : Params;

struct RotationMeta {
    // candidate weapon count; >0 means rotationContexts has one symbol map per weapon
    weaponCount: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(12)
var<uniform> rotationMeta: RotationMeta;

// how many combos one invocation walks
override CYCLES_PER_INVOCATION : u32 = __OPT_ROTATION_CYCLES__u;

// metadata unpack helpers
fn decodeComboMode(p: Params) -> u32 { return (p.meta0 >> 16u) & 0x3u; }
fn decodeComboK(p: Params) -> u32 { return (p.meta0 >> 18u) & 0x7u; }
fn decodeComboMaxCost(p: Params) -> f32 { return f32((p.meta0 >> 21u) & 0x3fu); }
fn decodeComboCount(p: Params) -> u32 { return p.meta1; }
fn decodeComboN(p: Params) -> u32 { return p.comboN; }
fn decodeLockedIndex(p: Params) -> i32 { return i32(p.lockedPacked) - 1; }
fn comboBaseIndex(p: Params) -> u32 { return p.comboBaseIndex; }
fn decodeDispatchWorkgroupBase(p: Params) -> u32 { return p.dispatchWorkgroupBase; }

struct ComboEval {
    // best weighted damage for this combo
    dmg: f32,

    // which of the 5 combo positions was chosen as main
    mainPos: u32,

    // which candidate weapon produced this best (0 when weapon search is off)
    weapon: u32,
};

// unrank a combinadic index into 5 sorted combo positions
fn buildComboIndices(index: u32) -> array<u32, 5> {
    var out: array<u32, 5>;
    for (var i: u32 = 0u; i < 5u; i = i + 1u) {
        out[i] = 0u;
    }

    let comboN = decodeComboN(params);
    let comboK = decodeComboK(params);
    let binomStride = 6u;

    var remainingK = comboK;
    var start: u32 = 0u;
    var rank: u32 = index;

    for (var pos: u32 = 0u; pos < comboK; pos = pos + 1u) {
        let remainingN = comboN - start;
        let total = comboBinom[remainingN * binomStride + remainingK];
        var low: u32 = 0u;
        var high: u32 = remainingN - remainingK + 1u;

        // binary search for the next picked item in the combination
        loop {
            if (low >= high) { break; }
            let mid = (low + high) / 2u;
            let right = comboBinom[(remainingN - mid) * binomStride + remainingK];
            let left = total - right;
            if (rank < left) {
                high = mid;
            } else {
                low = mid + 1u;
            }
        }

        let t = select(0u, low - 1u, low > 0u);
        let right = comboBinom[(remainingN - t) * binomStride + remainingK];
        let prefix = total - right;
        rank = rank - prefix;

        let i = start + t;
        out[pos] = i;
        remainingK = remainingK - 1u;
        start = i + 1u;
    }

    return out;
}

// map combo-local positions into actual echo indices, optionally appending the locked main
fn comboIndicesToEchoIds(combo: array<u32, 5>) -> array<i32, 5> {
    var out: array<i32, 5>;
    for (var i: u32 = 0u; i < 5u; i = i + 1u) {
        out[i] = -1;
    }

    let comboK = decodeComboK(params);
    for (var pos: u32 = 0u; pos < comboK; pos = pos + 1u) {
        out[pos] = comboIndexMap[combo[pos]];
    }

    let lockedIndex = decodeLockedIndex(params);
    if (lockedIndex >= 0 && comboK < 5u) {
        out[4] = lockedIndex;
    }

    return out;
}

fn buildEchoIds(index: u32) -> array<i32, 5> {
    if (decodeComboMode(params) == COMBO_MODE_BATCH) {
        var out: array<i32, 5>;
        let base = index * 5u;
        for (var pos: u32 = 0u; pos < 5u; pos = pos + 1u) {
            out[pos] = comboIndexMap[base + pos];
        }
        return out;
    }

    let combo = buildComboIndices(index);
    return comboIndicesToEchoIds(combo);
}
