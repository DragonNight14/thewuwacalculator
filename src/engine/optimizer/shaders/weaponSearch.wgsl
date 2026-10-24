/*
  Author: Runor Ewhro
  description: scores echo combos with weapon options and records the best pairing using targetCommon.wgsl.
*/

// each theory combo is scored against every weapon overlay (a compact per-weapon
// stat delta composed onto the shared base context) and the best weapon is
// packed into the candidate. theory batches only: the main echo is slot 0.

// per-weapon stat overlays. each weapon's 16 overlay floats (WEAPON_OVERLAY_SLOTS
// order) are stored as 4 consecutive vec4s, so weapon w occupies vec4s
// [w*4, w*4+4). a uniform (not storage) buffer to stay under the 10 storage-
// buffer per-stage limit; the data is tiny (<=31 weapons * 64 bytes). sized for
// up to 32 weapons (32 * 4 = 128 vec4s).
@group(0) @binding(13) var<uniform> weaponOverlays: array<vec4<f32>, 128>;

struct WeaponMeta {
    weaponCount: u32,
    overlayStride: u32,
    _pad0: u32,
    _pad1: u32,
};
@group(0) @binding(12) var<uniform> weaponMeta: WeaponMeta;

@group(0) @binding(9) var<storage, read_write> candidates: array<Candidate>;

// the shared base context. the scorer reads `params`, which contains the base
// context with the current weapon's overlay applied.
@group(0) @binding(4)
var<uniform> baseParams : Params;
var<private> params : Params;

// the high bits hold the chosen weapon index (must match WEAPON_INDEX_SHIFT in
// search/layout/constants.ts); theory batches pin the main, freeing the main-position bits.
const WEAPON_INDEX_SHIFT_C: u32 = 27u;

struct ComboEval {
    // best damage for this combo
    dmg: f32,

    // which weapon overlay produced the best damage
    weapon: u32,
};

// compose a per-weapon params from the shared base context plus weapon w's
// overlay. only the weapon-varying fields are overridden; everything else
// (scaling, enemy multipliers, skill id/meta, archetype) stays from base.
// overlay field order must match WEAPON_OVERLAY_SLOTS in search/layout/constants.ts.
fn applyOverlay(w: u32) -> Params {
    var p = baseParams;
    let base4 = w * 4u;
    // 4 vec4s == the 16 overlay floats in WEAPON_OVERLAY_SLOTS order
    let v0 = weaponOverlays[base4 + 0u];
    let v1 = weaponOverlays[base4 + 1u];
    let v2 = weaponOverlays[base4 + 2u];
    let v3 = weaponOverlays[base4 + 3u];
    p.baseAtk           = v0.x;
    p.finalAtk          = v0.y;
    p.finalHp           = v0.z;
    p.finalDef          = v0.w;
    p.baseER            = v1.x;
    p.critRate          = v1.y;
    p.critDmg           = v1.z;
    p.dmgBonus          = v1.w;
    p.dmgAmplify        = v2.x;
    p.multiplier        = v2.y;
    p.flatDmg           = v2.z;
    p.aux0              = v2.w;
    p.resMult           = v3.x;
    p.defMult           = v3.y;
    p.dmgReductionTotal = v3.z;
    p.dmgVuln           = v3.w;
    return p;
}

// score one theory combo (main at slot 0) against every weapon, keeping the best
fn computeDamageForEchoIds(echoIds: array<i32, 5>) -> ComboEval {
    let skillId: u32 = unpackSkillIdFromParams();
    let skillMask: u32 = skillMaskFromSkillId(skillId);
    let elementId: u32 = elementFromSkillId(skillId);
    let setRuntimeMask: u32 = decodeSetRuntimeMask(params);
    let lockedIndex: i32 = decodeLockedIndex(params);

    let base = buildEchoBase(echoIds);
    if (base.totalCost > decodeComboMaxCost(params)) {
        return ComboEval(0.0, 0u);
    }

    let mainId = echoIds[0];
    if (mainId < 0) { return ComboEval(0.0, 0u); }
    if (lockedIndex >= 0 && mainId != lockedIndex) { return ComboEval(0.0, 0u); }

    // skill mask and set mask are weapon-invariant
    let sonata = applySetEffects(base, skillMask, setRuntimeMask);

    var best: f32 = 0.0;
    var bestWeapon: u32 = 0u;
    for (var w: u32 = 0u; w < weaponMeta.weaponCount; w = w + 1u) {
        params = applyOverlay(w);
        let pre = buildPreMain(params, sonata, skillMask, elementId);
        let avg = evalMainEcho(pre, base, setRuntimeMask, u32(mainId));
        if (avg > best) {
            best = avg;
            bestWeapon = w;
        }
    }
    // the overlay only touches damage fields, so params need no reset here

    return ComboEval(best, bestWeapon);
}

@compute @workgroup_size(__OPT_TARGET_WORKGROUP_SIZE__)
fn main(
    @builtin(workgroup_id) wg: vec3<u32>,
    @builtin(local_invocation_id) lid3: vec3<u32>
) {
    params = baseParams;
    let comboCount = decodeComboCount(params);

    // dispatchWorkgroupBase lets the cpu split one big job into several submits
    let globalWorkgroup = decodeDispatchWorkgroupBase(params) + wg.x;
    let laneIndex = globalWorkgroup * __OPT_TARGET_WORKGROUP_SIZE__u + lid3.x;

    var idx: u32 = laneIndex * CYCLES_PER_INVOCATION;
    for (var j: u32 = 0u; j < CYCLES_PER_INVOCATION; j = j + 1u) {
        if (idx >= comboCount) { break; }
        let eval = computeDamageForEchoIds(buildEchoIds(comboBaseIndex(params) + idx));
        candidates[idx] = Candidate(max(eval.dmg, 0.0), (eval.weapon << WEAPON_INDEX_SHIFT_C) | idx);
        idx = idx + 1u;
    }
}
