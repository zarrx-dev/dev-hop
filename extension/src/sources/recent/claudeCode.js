// Claude Code keeps one JSONL transcript per session. The working folder is on some early line,
// not necessarily the first, so the head of each file is scanned.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { finish, listDirNames, mtimeMs } from './common.js';

export const HEAD_BYTES = 64 * 1024;
export const MAX_FILES = 200;

/**
 * First string `cwd` found in the text, one JSON object per line. A last line cut off by the
 * size limit simply fails to parse and is skipped.
 * @param {string} text
 * @returns {string|null}
 */
export function extractCwd(text) {
    for (const line of text.split('\n')) {
        if (!line.includes('"cwd"')) continue;
        try {
            const obj = JSON.parse(line);
            if (typeof obj?.cwd === 'string' && obj.cwd !== '') return obj.cwd;
        } catch (_e) {
            // Not a complete JSON line.
        }
    }
    return null;
}

function readHead(path) {
    try {
        const stream = Gio.File.new_for_path(path).read(null);
        const bytes = stream.read_bytes(HEAD_BYTES, null);
        stream.close(null);
        return new TextDecoder().decode(bytes.get_data() ?? new Uint8Array());
    } catch (_e) {
        return '';
    }
}

/**
 * The cwd of the 200 most recently modified transcripts, newest file first.
 * @param {{home?: string, cancellable?: Gio.Cancellable|null, maxFiles?: number}} [options]
 */
export async function read({
    home = GLib.get_home_dir(),
    cancellable = null,
    maxFiles = MAX_FILES,
} = {}) {
    const base = `${home}/.claude/projects`;
    const files = [];
    for (const dir of listDirNames(base)) {
        let names = [];
        try {
            const en = Gio.File.new_for_path(`${base}/${dir}`).enumerate_children(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE,
                null,
            );
            for (let i = en.next_file(null); i !== null; i = en.next_file(null)) {
                if (i.get_file_type() === Gio.FileType.REGULAR && i.get_name().endsWith('.jsonl')) {
                    names.push(i.get_name());
                }
            }
            en.close(null);
        } catch (_e) {
            names = [];
        }
        for (const name of names) {
            const path = `${base}/${dir}/${name}`;
            files.push({ path, time: mtimeMs(path) });
        }
    }
    files.sort((a, b) => b.time - a.time);

    const entries = [];
    for (const file of files.slice(0, maxFiles)) {
        if (cancellable?.is_cancelled()) break;
        const cwd = extractCwd(readHead(file.path));
        if (cwd) entries.push({ path: cwd, time: file.time });
    }
    return finish(entries);
}
