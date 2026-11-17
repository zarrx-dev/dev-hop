import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { expandHome, getJSON } from '../settings.js';
import { baseName } from './paths.js';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');

export const MAX_REPOS = 1000;
export const MAX_SCAN_MS = 3000;
const ATTRS = 'standard::name,standard::type,standard::is-symlink';

async function listChildren(dir, followRoot, cancellable) {
    const flags = followRoot
        ? Gio.FileQueryInfoFlags.NONE
        : Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS;
    const file = Gio.File.new_for_path(dir);
    let enumerator;
    try {
        enumerator = await file.enumerate_children_async(
            ATTRS,
            flags,
            GLib.PRIORITY_LOW,
            cancellable,
        );
    } catch (_e) {
        return [];
    }
    const out = [];
    try {
        for (;;) {
            const infos = await enumerator.next_files_async(100, GLib.PRIORITY_LOW, cancellable);
            if (infos.length === 0) break;
            for (const info of infos) {
                out.push({
                    name: info.get_name(),
                    type: info.get_file_type(),
                    symlink: info.get_is_symlink(),
                });
            }
        }
    } catch (_e) {
        // Cancelled or unreadable: keep what was read.
    }
    try {
        enumerator.close(null);
    } catch (_e) {
        // Nothing useful to do.
    }
    return out;
}

/**
 * Find git repositories below the roots. A folder with a `.git` folder is a repo and is not
 * searched further; a `.git` file marks a linked worktree, listed only when asked for.
 * @param {{roots: string[], depth: number, skipDirs?: string[], includeWorktrees?: boolean,
 *   maxRepos?: number, maxMs?: number, cancellable?: Gio.Cancellable|null}} options
 * @returns {Promise<{kind: 'project', path: string, name: string, source: 'git',
 *   worktree: boolean}[]>}
 */
export async function scanRepos(options) {
    const {
        roots,
        depth,
        skipDirs = [],
        includeWorktrees = false,
        maxRepos = MAX_REPOS,
        maxMs = MAX_SCAN_MS,
        cancellable = null,
    } = options;
    const skip = new Set(skipDirs);
    const deadline = GLib.get_monotonic_time() + maxMs * 1000;
    const found = [];
    const seen = new Set();

    const stop = () =>
        found.length >= maxRepos ||
        GLib.get_monotonic_time() > deadline ||
        (cancellable?.is_cancelled() ?? false);

    const queue = [];
    for (const root of roots) queue.push({ dir: root, level: 0 });

    while (queue.length > 0 && !stop()) {
        const { dir, level } = queue.shift();
        if (seen.has(dir)) continue;
        seen.add(dir);
        const children = await listChildren(dir, level === 0, cancellable);
        const gitEntry = children.find((c) => c.name === '.git' && !c.symlink);
        if (gitEntry) {
            const isDirEntry = gitEntry.type === Gio.FileType.DIRECTORY;
            const worktree = !isDirEntry;
            if (isDirEntry || includeWorktrees) {
                found.push({
                    kind: 'project',
                    path: dir,
                    name: baseName(dir),
                    source: 'git',
                    worktree,
                });
            }
            continue;
        }
        if (level >= depth) continue;
        for (const c of children) {
            if (c.type !== Gio.FileType.DIRECTORY || c.symlink) continue;
            if (c.name.startsWith('.') || skip.has(c.name)) continue;
            queue.push({ dir: `${dir === '/' ? '' : dir}/${c.name}`, level: level + 1 });
        }
    }
    return found.slice(0, maxRepos);
}

/**
 * Scan using the settings keys search-roots, scan-depth, skip-dirs and include-worktrees.
 * @param {object} settings
 * @param {Gio.Cancellable|null} [cancellable]
 */
export function scanGit(settings, cancellable = null) {
    const roots = getJSON(settings, 'search-roots', '[]');
    return scanRepos({
        roots: Array.isArray(roots) ? roots.map((r) => expandHome(String(r))) : [],
        depth: settings.get_int('scan-depth'),
        skipDirs: getJSON(settings, 'skip-dirs', '[]'),
        includeWorktrees: settings.get_boolean('include-worktrees'),
        cancellable,
    });
}
