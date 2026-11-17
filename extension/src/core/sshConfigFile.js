// Writing the ssh config safely: timestamped backup, temp file in the same folder, rename.
import GLib from 'gi://GLib';

const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {Date} date
 * @returns {string} `config.YYYYMMDD-HHMMSS.bak` in local time
 */
export function backupName(date) {
    const d = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    const t = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    return `config.${d}-${t}.bak`;
}

function writeFile(path, text) {
    GLib.file_set_contents_full(
        path,
        new TextEncoder().encode(text),
        GLib.FileSetContentsFlags.NONE,
        0o600,
    );
    GLib.chmod(path, 0o600);
}

/**
 * Save the config. An existing file is copied to a backup next to it first; the new text goes
 * to a temp file in the same folder (mode 600) that is renamed over the original. A missing
 * file is created with mode 600 and a missing folder with mode 700.
 * @param {string} path absolute path of the config file
 * @param {string} text
 * @param {Date} [now]
 * @returns {{backup: string|null}} the backup path, or null when there was nothing to back up
 */
export function writeWithBackup(path, text, now = new Date()) {
    const dir = GLib.path_get_dirname(path);
    if (GLib.mkdir_with_parents(dir, 0o700) !== 0) throw new Error(`Cannot create ${dir}`);

    let backup = null;
    if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
        const [, bytes] = GLib.file_get_contents(path);
        backup = GLib.build_filenamev([dir, backupName(now)]);
        GLib.file_set_contents_full(backup, bytes, GLib.FileSetContentsFlags.NONE, 0o600);
        GLib.chmod(backup, 0o600);
    }

    const tmp = GLib.build_filenamev([dir, `.config.dev-hop-${GLib.random_int()}.tmp`]);
    try {
        writeFile(tmp, text);
        if (GLib.rename(tmp, path) !== 0) throw new Error(`Cannot replace ${path}`);
    } catch (e) {
        GLib.unlink(tmp);
        throw e;
    }
    return { backup };
}
