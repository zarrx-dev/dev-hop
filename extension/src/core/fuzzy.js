// Fuzzy subsequence matching for the search popup.

const BONUS_START = 8;
const BONUS_BOUNDARY = 6;
const BONUS_CONSECUTIVE = 7;
const LENGTH_PENALTY = 0.05;

/** Field weights used by rank() when a field is given as a plain string. */
const DEFAULT_WEIGHTS = { name: 2 };

function isBoundary(text, j) {
    if (j === 0) return true;
    const prev = text[j - 1];
    const cur = text[j];
    if ('-_/. '.includes(prev)) return true;
    return prev === prev.toLowerCase() && prev !== prev.toUpperCase() && cur !== cur.toLowerCase();
}

/**
 * Case-insensitive subsequence match. The best alignment wins: bonuses for the first
 * character, word boundaries (`-` `_` `/` `.` space, camelCase) and consecutive runs, and a
 * small penalty for long text.
 * @param {string} query
 * @param {string} text
 * @returns {{score: number, indices: number[]}|null} null when the query does not match;
 *   an empty query matches with score 0
 */
export function score(query, text) {
    if (query === '') return { score: 0, indices: [] };
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    const n = q.length;
    const m = t.length;
    if (n > m) return null;

    // best[i][j]: best score matching q[0..i] with q[i] at text position j.
    const best = [];
    const from = [];
    for (let i = 0; i < n; i++) {
        best.push(new Array(m).fill(-Infinity));
        from.push(new Array(m).fill(-1));
        let runMax = -Infinity;
        let runArg = -1;
        for (let j = i; j < m; j++) {
            // runMax tracks the best previous-row score at positions <= j - 2.
            if (i > 0 && j - 2 >= 0 && best[i - 1][j - 2] > runMax) {
                runMax = best[i - 1][j - 2];
                runArg = j - 2;
            }
            if (t[j] !== q[i]) continue;
            let gain = 1;
            if (j === 0) gain += BONUS_START;
            else if (isBoundary(text, j)) gain += BONUS_BOUNDARY;
            if (i === 0) {
                best[i][j] = gain;
                continue;
            }
            let prev = runMax;
            let prevAt = runArg;
            const adjacent = j - 1 >= 0 ? best[i - 1][j - 1] + BONUS_CONSECUTIVE : -Infinity;
            if (adjacent > prev) {
                prev = adjacent;
                prevAt = j - 1;
            }
            if (prev === -Infinity) continue;
            best[i][j] = prev + gain;
            from[i][j] = prevAt;
        }
    }

    let end = -1;
    let top = -Infinity;
    for (let j = 0; j < m; j++) {
        if (best[n - 1][j] > top) {
            top = best[n - 1][j];
            end = j;
        }
    }
    if (end < 0) return null;
    const indices = new Array(n);
    for (let i = n - 1, j = end; i >= 0; i--) {
        indices[i] = j;
        j = from[i][j];
    }
    return { score: top - m * LENGTH_PENALTY, indices };
}

function fieldText(item, key) {
    const v = item[key];
    if (Array.isArray(v)) return v.join(' ');
    return v === undefined || v === null ? '' : String(v);
}

/**
 * Sort items by their best weighted score across `fields`; items that do not match are
 * dropped. An empty query returns a copy of the input in its original order. Ties keep the
 * input order.
 * @template T
 * @param {string} query
 * @param {T[]} items
 * @param {(string|{key: string, weight?: number})[]} fields a plain `name` weighs 2, other
 *   plain strings 1; use `{key, weight}` to choose
 * @returns {T[]}
 */
export function rank(query, items, fields) {
    if (query === '') return items.slice();
    const specs = fields.map((f) =>
        typeof f === 'string' ? { key: f, weight: DEFAULT_WEIGHTS[f] ?? 1 } : { weight: 1, ...f },
    );
    const scored = [];
    items.forEach((item, order) => {
        let top = null;
        for (const { key, weight } of specs) {
            const r = score(query, fieldText(item, key));
            if (r === null) continue;
            const s = r.score * weight;
            if (top === null || s > top) top = s;
        }
        if (top !== null) scored.push({ item, top, order });
    });
    scored.sort((a, b) => b.top - a.top || a.order - b.order);
    return scored.map((s) => s.item);
}
