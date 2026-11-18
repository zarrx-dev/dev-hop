// Finding programs. The desktop session PATH is often only the system folders, so per-user
// install folders are searched as well.
import GLib from 'gi://GLib';

/** Per-user install folders, relative to home, searched after PATH. */
const USER_DIRS = [
    '.local/bin',
    'bin',
    '.cargo/bin',
    'go/bin',
    '.npm-global/bin',
    '.bun/bin',
    '.deno/bin',
];

/** Flatpak export folders, relative to home when they start with `~/`. */
const FLATPAK_DIRS = ['~/.local/share/flatpak/exports/bin', '/var/lib/flatpak/exports/bin'];

function expand(dir, home) {
    if (dir === '~') return home;
    if (dir.startsWith('~/')) return `${home}/${dir.slice(2)}`;
    return dir;
}

/**
 * The folders to search, in order: every PATH entry, then the user folders, then Flatpak exports.
 * Pure: home and PATH are passed in. A leading `~` is expanded and repeats are dropped.
 * @param {{home: string, envPath?: string|null}} options
 * @returns {string[]}
 */
export function searchDirs({ home, envPath }) {
    const candidates = [
        ...(envPath ?? '').split(':'),
        ...USER_DIRS.map((d) => `${home}/${d}`),
        ...FLATPAK_DIRS,
    ];
    const seen = new Set();
    const out = [];
    for (const raw of candidates) {
        if (!raw) continue;
        const dir = expand(raw, home);
        if (seen.has(dir)) continue;
        seen.add(dir);
        out.push(dir);
    }
    return out;
}

/**
 * Find a program. An absolute name is checked directly, otherwise the first folder holding it wins.
 * @param {string} name
 * @param {string[]} dirs
 * @param {(path: string) => boolean} isExecutable
 * @returns {string|null} the absolute path, or null
 */
export function findInDirs(name, dirs, isExecutable) {
    if (!name) return null;
    if (name.startsWith('/')) return isExecutable(name) ? name : null;
    if (name.includes('/')) return null;
    for (const dir of dirs) {
        const path = `${dir}/${name}`;
        if (isExecutable(path)) return path;
    }
    return null;
}

/** True for an executable file that is not a folder. */
export function isExecutableFile(path) {
    return (
        GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE) &&
        !GLib.file_test(path, GLib.FileTest.IS_DIR)
    );
}

/** @returns {string[]} the real search folders for this session */
export function currentSearchDirs() {
    return searchDirs({ home: GLib.get_home_dir(), envPath: GLib.getenv('PATH') });
}

/**
 * @param {string} name
 * @returns {string|null} the absolute path of the program, or null when it is not found
 */
export function findProgram(name) {
    return findInDirs(name, currentSearchDirs(), isExecutableFile);
}
