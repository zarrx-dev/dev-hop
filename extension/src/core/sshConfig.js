// OpenSSH client config reader and editor. The model keeps every original line
// verbatim (text plus its own line ending) so an unedited file round-trips byte for byte.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/** Keywords exposed as editable fields, in the order new ones are written. */
export const KNOWN_FIELDS = ['HostName', 'User', 'Port', 'IdentityFile', 'ProxyJump'];

const DEFAULT_INDENT = '    ';
const MAX_INCLUDE_DEPTH = 8;

/**
 * @typedef {{text: string, eol: string}} Line
 * @typedef {{lines: Line[], eol: string}} SshModel
 * @typedef {{index: number|null, aliases: string[], editable: boolean, source: string|null,
 *   fields: {HostName: string, User: string, Port: string, IdentityFile: string,
 *   ProxyJump: string}}} HostEntry
 */

/**
 * Parse config text into a model. Mutating functions below change the model in place.
 * @param {string} text
 * @returns {SshModel}
 */
export function parse(text) {
    const lines = [];
    const re = /\r\n|\n/g;
    let last = 0;
    let m = re.exec(text);
    while (m !== null) {
        lines.push({ text: text.slice(last, m.index), eol: m[0] });
        last = m.index + m[0].length;
        m = re.exec(text);
    }
    if (last < text.length) lines.push({ text: text.slice(last), eol: '' });
    const eol = lines.find((l) => l.eol)?.eol ?? '\n';
    return { lines, eol };
}

/**
 * @param {SshModel} model
 * @returns {string} The config text; identical to the parsed input when unedited.
 */
export function serialize(model) {
    return model.lines.map((l) => l.text + l.eol).join('');
}

function isBlank(text) {
    return text.trim() === '';
}

function isComment(text) {
    return text.trimStart().startsWith('#');
}

function indentLength(text) {
    return text.length - text.trimStart().length;
}

/** Returns {indent, keyword, sep, value} for a keyword line, or null for blanks and comments. */
function parseLine(text) {
    const m = /^([ \t]*)([A-Za-z][A-Za-z0-9]*)(?:([ \t]*=[ \t]*)|([ \t]+))?(.*?)[ \t]*$/.exec(text);
    if (!m) return null;
    const sep = m[3] ?? m[4] ?? '';
    if (!sep && m[5] !== '') return null;
    return { indent: m[1], keyword: m[2], sep, value: m[5] };
}

/** Split a value on whitespace, honouring double quotes. */
function splitArgs(value) {
    const out = [];
    let cur = '';
    let inQuote = false;
    let has = false;
    for (const ch of value) {
        if (ch === '"') {
            inQuote = !inQuote;
            has = true;
        } else if (!inQuote && /\s/.test(ch)) {
            if (has) out.push(cur);
            cur = '';
            has = false;
        } else {
            cur += ch;
            has = true;
        }
    }
    if (has) out.push(cur);
    return out;
}

function formatValue(value) {
    return /\s/.test(value) ? `"${value}"` : value;
}

const isWild = (alias) => /[*?!]/.test(alias);

/** Split the file into top, Host and Match blocks; `end` is exclusive. */
function findBlocks(lines) {
    const blocks = [];
    let cur = { type: 'top', start: 0, head: null };
    for (let i = 0; i < lines.length; i++) {
        const p = parseLine(lines[i].text);
        const k = p?.keyword.toLowerCase();
        if (k === 'host' || k === 'match') {
            cur.end = i;
            if (cur.end > cur.start) blocks.push(cur);
            cur = { type: k, start: i, head: p };
        }
    }
    cur.end = lines.length;
    if (cur.end > cur.start) blocks.push(cur);
    return blocks;
}

function hostBlocks(model) {
    return findBlocks(model.lines).filter((b) => b.type === 'host');
}

/**
 * End of the block's own content: trailing blank lines and comment lines that sit at or left
 * of the Host line's indentation are treated as belonging to whatever follows.
 */
function bodyEnd(lines, block) {
    const hostIndent = block.head.indent.length;
    let e = block.end;
    while (e > block.start + 1) {
        const text = lines[e - 1].text;
        if (isBlank(text) || (isComment(text) && indentLength(text) <= hostIndent)) e--;
        else break;
    }
    return e;
}

function blockFields(lines, block) {
    const fields = {};
    for (const k of KNOWN_FIELDS) fields[k] = '';
    const seen = new Set();
    for (let i = block.start + 1; i < block.end; i++) {
        const p = parseLine(lines[i].text);
        if (!p) continue;
        const key = KNOWN_FIELDS.find((f) => f.toLowerCase() === p.keyword.toLowerCase());
        if (key && !seen.has(key)) {
            seen.add(key);
            fields[key] = splitArgs(p.value)[0] ?? '';
        }
    }
    return fields;
}

function entriesFor(model, source) {
    const out = [];
    hostBlocks(model).forEach((block, index) => {
        const aliases = splitArgs(block.head.value);
        if (aliases.every(isWild)) return;
        out.push({
            index: source ? null : index,
            aliases,
            editable: !source && !aliases.some(isWild),
            source: source ?? null,
            fields: blockFields(model.lines, block),
        });
    });
    return out;
}

/**
 * One entry per Host block, skipping blocks whose aliases are all patterns. `index` is the
 * position among all Host blocks in the file (pattern blocks included) and is what
 * updateHost and deleteHost expect. If a keyword repeats, the first one is reported.
 * @param {SshModel} model
 * @returns {HostEntry[]}
 */
export function listHosts(model) {
    return entriesFor(model, null);
}

function getEditableBlock(model, blockIndex) {
    const block = hostBlocks(model)[blockIndex];
    if (!block) throw new Error(`No Host block with index ${blockIndex}`);
    if (splitArgs(block.head.value).some(isWild)) {
        throw new Error('Host blocks with wildcard patterns cannot be edited');
    }
    return block;
}

function spliceLines(lines, at, texts, eol) {
    const fresh = texts.map((text) => ({ text, eol }));
    lines.splice(at, 0, ...fresh);
}

/**
 * Change one Host block. Only that block's lines are touched.
 * Field values: undefined leaves the field alone, '' or null removes it, anything else sets it.
 * `fields.aliases` (string array) rewrites the Host line. If a keyword is repeated, only the
 * first occurrence is updated, but removal removes all of them.
 * @param {SshModel} model
 * @param {number} blockIndex
 * @param {{aliases?: string[], HostName?: string, User?: string, Port?: string|number,
 *   IdentityFile?: string, ProxyJump?: string}} fields
 * @returns {SshModel} the same model
 */
export function updateHost(model, blockIndex, fields) {
    const block = getEditableBlock(model, blockIndex);
    const lines = model.lines;
    const reachedEnd = block.end === lines.length;
    const origLastEol = reachedEnd ? lines[lines.length - 1].eol : '';
    const seg = lines.slice(block.start, block.end).map((l) => ({ ...l }));
    const head = block.head;

    if (fields.aliases !== undefined) {
        if (fields.aliases.length === 0) throw new Error('A Host block needs at least one alias');
        const current = splitArgs(head.value);
        const same =
            current.length === fields.aliases.length &&
            current.every((a, i) => a === fields.aliases[i]);
        if (!same) {
            seg[0].text = `${head.indent}${head.keyword}${head.sep || ' '}${fields.aliases
                .map(formatValue)
                .join(' ')}`;
        }
    }

    const pending = [];
    for (const key of KNOWN_FIELDS) {
        if (fields[key] === undefined) continue;
        const value = String(fields[key] ?? '').trim();
        const matches = [];
        for (let i = 1; i < seg.length; i++) {
            const p = parseLine(seg[i].text);
            if (p && p.keyword.toLowerCase() === key.toLowerCase()) matches.push([i, p]);
        }
        if (value === '') {
            for (const [i] of matches.reverse()) seg.splice(i, 1);
        } else if (matches.length > 0) {
            const [i, p] = matches[0];
            if ((splitArgs(p.value)[0] ?? '') !== value) {
                seg[i].text = `${p.indent}${p.keyword}${p.sep}${formatValue(value)}`;
            }
        } else {
            pending.push([key, value]);
        }
    }

    if (pending.length > 0) {
        let indent = DEFAULT_INDENT;
        for (let i = 1; i < seg.length; i++) {
            const p = parseLine(seg[i].text);
            if (p) {
                indent = p.indent;
                break;
            }
        }
        const at = bodyEnd(seg, { start: 0, end: seg.length, head });
        const texts = pending.map(([k, v]) => `${indent}${k} ${formatValue(v)}`);
        const atFileEnd = reachedEnd && at === seg.length;
        if (atFileEnd && origLastEol === '') seg[at - 1].eol = model.eol;
        spliceLines(seg, at, texts, model.eol);
        if (atFileEnd && origLastEol === '') seg[seg.length - 1].eol = '';
    }

    lines.splice(block.start, block.end - block.start, ...seg);
    return model;
}

/**
 * Append a new Host block, preceded by one blank line unless the file is empty or already
 * ends in one. The file ends with a line break afterwards.
 * @param {SshModel} model
 * @param {string|string[]} alias
 * @param {{HostName?: string, User?: string, Port?: string|number, IdentityFile?: string,
 *   ProxyJump?: string}} [fields]
 * @returns {number} the new block's index
 */
export function addHost(model, alias, fields = {}) {
    const aliases = Array.isArray(alias) ? alias : [alias];
    if (aliases.length === 0 || aliases.some((a) => a === '')) throw new Error('Alias is empty');
    const lines = model.lines;
    const texts = [];
    if (lines.length > 0 && !isBlank(lines[lines.length - 1].text)) texts.push('');
    texts.push(`Host ${aliases.map(formatValue).join(' ')}`);
    for (const key of KNOWN_FIELDS) {
        const value = String(fields[key] ?? '').trim();
        if (value !== '') texts.push(`${DEFAULT_INDENT}${key} ${formatValue(value)}`);
    }
    if (lines.length > 0 && lines[lines.length - 1].eol === '') {
        lines[lines.length - 1].eol = model.eol;
    }
    spliceLines(lines, lines.length, texts, model.eol);
    return hostBlocks(model).length - 1;
}

/**
 * Remove a Host block and one adjoining blank line (the one after it, else the one before).
 * @param {SshModel} model
 * @param {number} blockIndex
 * @returns {SshModel} the same model
 */
export function deleteHost(model, blockIndex) {
    const block = getEditableBlock(model, blockIndex);
    const lines = model.lines;
    const origLastEol = lines[lines.length - 1].eol;
    const end = bodyEnd(lines, block);
    let from = block.start;
    let to = end;
    if (to < lines.length && isBlank(lines[to].text)) to++;
    else if (from > 0 && isBlank(lines[from - 1].text)) from--;
    const removedToEnd = to === lines.length;
    lines.splice(from, to - from);
    if (removedToEnd && lines.length > 0) lines[lines.length - 1].eol = origLastEol;
    return model;
}

/** Expand a leading ~ to the home folder. */
export function expandHome(path, home = GLib.get_home_dir()) {
    if (path === '~') return home;
    if (path.startsWith('~/')) return `${home}${path.slice(1)}`;
    return path;
}

/** Include arguments of every Include line, as written. */
export function includePatterns(model) {
    const out = [];
    for (const line of model.lines) {
        const p = parseLine(line.text);
        if (p && p.keyword.toLowerCase() === 'include') out.push(...splitArgs(p.value));
    }
    return out;
}

function defaultReadFile(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : null;
    } catch (_e) {
        return null;
    }
}

function defaultListDir(dir) {
    const names = [];
    try {
        const en = Gio.File.new_for_path(dir).enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null,
        );
        for (let info = en.next_file(null); info !== null; info = en.next_file(null)) {
            names.push(info.get_name());
        }
        en.close(null);
    } catch (_e) {
        return [];
    }
    return names;
}

function globToRegExp(glob) {
    let re = '';
    for (const ch of glob) {
        if (ch === '*') re += '[^/]*';
        else if (ch === '?') re += '[^/]';
        else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}$`);
}

/** Expand `*` and `?` in an absolute path, one component at a time. */
function expandGlob(pattern, listDir) {
    if (!/[*?]/.test(pattern)) return [pattern];
    let bases = [''];
    for (const comp of pattern.split('/').slice(1)) {
        const next = [];
        for (const base of bases) {
            if (/[*?]/.test(comp)) {
                const re = globToRegExp(comp);
                for (const name of listDir(base || '/').sort()) {
                    if (re.test(name)) next.push(`${base}/${name}`);
                }
            } else {
                next.push(`${base}/${comp}`);
            }
        }
        bases = next;
    }
    return bases;
}

/**
 * Read a config file and the files it includes. Relative Include paths are taken from
 * `<home>/.ssh/`, `~` is expanded and `*` / `?` globs are expanded. Hosts found in included
 * files are read-only: `editable: false`, `index: null`, `source: <file>`.
 * @param {string} path main config file (`~` allowed)
 * @param {(path: string) => string|null} [readFile] returns the text, or null if unreadable
 * @param {{home?: string, listDir?: (dir: string) => string[]}} [options]
 * @returns {{model: SshModel, hosts: HostEntry[]}}
 */
export function loadWithIncludes(path, readFile = defaultReadFile, options = {}) {
    const home = options.home ?? GLib.get_home_dir();
    const listDir = options.listDir ?? defaultListDir;
    const mainPath = expandHome(path, home);
    const model = parse(readFile(mainPath) ?? '');
    const hosts = entriesFor(model, null);
    const visited = new Set([mainPath]);

    const walk = (fromModel, depth) => {
        if (depth > MAX_INCLUDE_DEPTH) return;
        for (const pattern of includePatterns(fromModel)) {
            let p = expandHome(pattern, home);
            if (!p.startsWith('/')) p = `${home}/.ssh/${p}`;
            for (const file of expandGlob(p, listDir)) {
                if (visited.has(file)) continue;
                visited.add(file);
                const text = readFile(file);
                if (text === null || text === undefined) continue;
                const included = parse(text);
                hosts.push(...entriesFor(included, file));
                walk(included, depth + 1);
            }
        }
    };
    walk(model, 1);
    return { model, hosts };
}
