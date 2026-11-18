// Strict matching for the search popup and the menu search, like editor quick-open.
//
// A query matches a text when it is a plain substring of it (anywhere), or when it splits into
// runs of consecutive characters that each start at a word boundary ("dh" in "dev-hop").
// Letters scattered in the middle of words never match.

const SUBSTRING_BASE = 1000;
const SUBSTRING_START = 40;
const SUBSTRING_BOUNDARY = 20;
const CHAR_GAIN = 2;
const RUN_GAIN = 5;
const RUN_PENALTY = 3;
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

function range(from, count) {
    return Array.from({ length: count }, (_, i) => from + i);
}

/** Best plain-substring match, preferring the start of the text, then word boundaries. */
function substringMatch(q, t, text) {
    let best = null;
    let at = t.indexOf(q);
    while (at !== -1) {
        let gain = 0;
        if (at === 0) gain = SUBSTRING_START;
        else if (isBoundary(text, at)) gain = SUBSTRING_BOUNDARY;
        if (best === null || gain > best.gain) best = { at, gain };
        at = t.indexOf(q, at + 1);
    }
    if (best === null) return null;
    return {
        score: SUBSTRING_BASE + q.length * CHAR_GAIN + best.gain - t.length * LENGTH_PENALTY,
        indices: range(best.at, q.length),
    };
}

/** Best split of the query into runs that each start at a word boundary, in text order. */
function wordStartMatch(q, t, text) {
    const n = q.length;
    const m = t.length;
    const memo = new Map();
    // best(qi, from): best way to match q[qi..] using text positions >= from.
    const best = (qi, from) => {
        if (qi === n) return { score: 0, indices: [] };
        const key = qi * (m + 1) + from;
        if (memo.has(key)) return memo.get(key);
        let top = null;
        for (let j = from; j < m; j++) {
            if (t[j] !== q[qi] || !isBoundary(text, j)) continue;
            let len = 0;
            while (qi + len < n && j + len < m && t[j + len] === q[qi + len]) {
                len++;
                const rest = best(qi + len, j + len);
                if (rest === null) continue;
                const s = len * CHAR_GAIN + RUN_GAIN - RUN_PENALTY + rest.score;
                if (top === null || s > top.score) {
                    top = { score: s, indices: [...range(j, len), ...rest.indices] };
                }
            }
        }
        memo.set(key, top);
        return top;
    };
    const r = best(0, 0);
    if (r === null) return null;
    return { score: r.score - m * LENGTH_PENALTY, indices: r.indices };
}

/**
 * Case-insensitive strict match. A plain substring scores highest (more at the start of the
 * text or at a word boundary). Otherwise every run of consecutive query characters must start
 * at a word boundary (`-` `_` `/` `.` space, camelCase, start of text); fewer runs and shorter
 * text score higher.
 * @param {string} query
 * @param {string} text
 * @returns {{score: number, indices: number[]}|null} null when the query does not match;
 *   an empty query matches with score 0
 */
export function score(query, text) {
    if (query === '') return { score: 0, indices: [] };
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (q.length > t.length) return null;
    // toLowerCase can change the length for some characters; skip matching then.
    if (t.length !== text.length) return null;
    return substringMatch(q, t, text) ?? wordStartMatch(q, t, text);
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
