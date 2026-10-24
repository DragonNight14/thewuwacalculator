/*
  Author: Runor Ewhro
  description: enumerates cost-legal combinations for target and rotation kernels.
*/

// costLayout stores counts, group starts, group sizes, then segment ranks
// and four-bit pick counts; comboBinom has a stride of six.
const COST_LAYOUT_HEADER: u32 = 3u;

// inventory enumeration position: index-map positions plus, per position, its
// cost group (3 bits each) and the highest index-map position it may reach
struct CostCursor {
    combo: array<u32, 5>,
    posGroups: u32,
    segment: u32,
};

fn binomAt(n: u32, k: u32) -> u32 {
    if (k > n) { return 0u; }
    return comboBinom[n * 6u + k];
}

fn posGroupOf(cursor: CostCursor, pos: u32) -> u32 {
    return (cursor.posGroups >> (pos * 3u)) & 7u;
}

// unrank one local rank inside a segment: a mixed-radix product of per-group
// lexicographic combinations, last group fastest
fn enterCostSegment(segment: u32, localRank: u32) -> CostCursor {
    var cursor: CostCursor;
    cursor.segment = segment;
    cursor.posGroups = 0u;
    for (var c: u32 = 0u; c < 5u; c = c + 1u) {
        cursor.combo[c] = 0u;
    }

    let groupCount = costLayout[0u].x;
    let packed = costLayout[COST_LAYOUT_HEADER + segment].y;

    var sub: array<u32, 4>;
    var local = localRank;
    for (var gi: i32 = 3; gi >= 0; gi = gi - 1) {
        let g = u32(gi);
        sub[g] = 0u;
        if (g >= groupCount) { continue; }
        let size = max(binomAt(costLayout[2u][g], (packed >> (g * 4u)) & 0xfu), 1u);
        sub[g] = local % size;
        local = local / size;
    }

    var pos: u32 = 0u;
    for (var g: u32 = 0u; g < 4u; g = g + 1u) {
        if (g >= groupCount) { break; }
        let k = (packed >> (g * 4u)) & 0xfu;
        let n = costLayout[2u][g];
        let start = costLayout[1u][g];
        var rank = sub[g];
        var first: u32 = 0u;

        for (var q: u32 = 0u; q < k; q = q + 1u) {
            let remainingK = k - q;
            let remainingN = n - first;
            let total = binomAt(remainingN, remainingK);
            var low: u32 = 0u;
            var high: u32 = remainingN - remainingK + 1u;

            // binary search the next chosen element, as buildComboIndices does
            loop {
                if (low >= high) { break; }
                let mid = (low + high) / 2u;
                let left = total - binomAt(remainingN - mid, remainingK);
                if (rank < left) {
                    high = mid;
                } else {
                    low = mid + 1u;
                }
            }

            let t = select(0u, low - 1u, low > 0u);
            rank = rank - (total - binomAt(remainingN - t, remainingK));

            let i = first + t;
            cursor.combo[pos] = start + i;
            cursor.posGroups = cursor.posGroups | (g << (pos * 3u));
            first = i + 1u;
            pos = pos + 1u;
        }
    }

    return cursor;
}

fn costCursorAt(rank: u32) -> CostCursor {
    let segmentCount = costLayout[0u].y;
    var segment: u32 = 0u;
    for (var s: u32 = 1u; s < segmentCount; s = s + 1u) {
        if (costLayout[COST_LAYOUT_HEADER + s].x > rank) { break; }
        segment = s;
    }
    return enterCostSegment(segment, rank - costLayout[COST_LAYOUT_HEADER + segment].x);
}

// step to the next combo in rank order; false once the layout is exhausted
fn advanceCostCursor(cursor: ptr<function, CostCursor>, comboK: u32) -> bool {
    var i: i32 = i32(comboK) - 1;
    loop {
        if (i < 0) { break; }
        let ui = u32(i);
        // a group's positions end at its last index-map slot, so position ui
        // tops out (positions left in its group) below the group's end
        let group = posGroupOf(*cursor, ui);
        var groupEndPos: u32 = ui + 1u;
        for (var t: u32 = ui + 1u; t < comboK; t = t + 1u) {
            if (posGroupOf(*cursor, t) == group) { groupEndPos = t + 1u; }
        }
        let posMax = costLayout[1u][group] + costLayout[2u][group] - (groupEndPos - ui);
        if ((*cursor).combo[ui] < posMax) {
            (*cursor).combo[ui] = (*cursor).combo[ui] + 1u;
            for (var t: u32 = ui + 1u; t < comboK; t = t + 1u) {
                let group = posGroupOf(*cursor, t);
                (*cursor).combo[t] = select(
                    costLayout[1u][group],
                    (*cursor).combo[t - 1u] + 1u,
                    group == posGroupOf(*cursor, t - 1u),
                );
            }
            return true;
        }
        i = i - 1;
    }

    let next = (*cursor).segment + 1u;
    if (next >= costLayout[0u].y) { return false; }
    *cursor = enterCostSegment(next, 0u);
    return true;
}
