// Reads SQLite databases through the sqlite3 command, so the extension needs no bindings.
import Gio from 'gi://Gio';
import { findProgram as findOnSystem } from '../../core/programs.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

export function sqliteAvailable(findProgram = findOnSystem) {
    return Boolean(findProgram('sqlite3'));
}

/**
 * Run a query and return its rows. Any problem (no sqlite3, locked or unreadable database, bad
 * SQL, cancelled) gives [].
 * @param {string} dbPath
 * @param {string} sql
 * @param {Gio.Cancellable|null} [cancellable]
 * @returns {Promise<object[]>}
 */
export async function queryJson(dbPath, sql, cancellable = null) {
    if (!sqliteAvailable()) return [];
    try {
        const proc = Gio.Subprocess.new(
            ['sqlite3', '-readonly', '-json', dbPath, sql],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
        );
        // The promisified call returns [stdout, stderr], without the leading boolean.
        const [stdout] = await proc.communicate_utf8_async(null, cancellable);
        if (!proc.get_successful() || !stdout || stdout.trim() === '') return [];
        const rows = JSON.parse(stdout);
        return Array.isArray(rows) ? rows : [];
    } catch (_e) {
        return [];
    }
}
