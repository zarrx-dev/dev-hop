// Reading and changing the ssh config from the preferences window. Every change re-reads the
// file first and applies to that fresh text, so edits made elsewhere in the meantime are kept.
import GLib from 'gi://GLib';
import { listHosts, parse, serialize } from '../core/sshConfig.js';
import { writeWithBackup } from '../core/sshConfigFile.js';
import { expandHome } from '../settings.js';

/** @returns {string} the absolute path from the ssh-config-path setting */
export function configPath(settings) {
    return expandHome(settings.get_string('ssh-config-path'));
}

/** @returns {string} the file text, or '' when it does not exist or cannot be read */
export function readConfigText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : '';
    } catch (_e) {
        return '';
    }
}

/**
 * Index of the editable Host block whose first alias is `alias`, in a freshly parsed model.
 * @returns {number} the block index for updateHost and deleteHost, or -1 when it is gone
 */
export function findBlockIndex(model, alias) {
    const entry = listHosts(model).find((h) => h.editable && h.aliases[0] === alias);
    return entry ? entry.index : -1;
}

/**
 * Re-read the file, let `mutate` change the fresh model, then write it with a backup.
 * @param {string} path absolute path of the config file
 * @param {(model: object) => void} mutate may throw to cancel the write
 * @returns {{backup: string|null}}
 */
export function applyChange(path, mutate) {
    const model = parse(readConfigText(path));
    mutate(model);
    return writeWithBackup(path, serialize(model));
}
