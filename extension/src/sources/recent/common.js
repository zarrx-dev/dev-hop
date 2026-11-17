// Shared helpers for the recent-folder readers. Times are milliseconds since the epoch.
import Gio from 'gi://Gio';
import { isDir } from '../paths.js';

/**
 * Keep existing folders only, dedupe by path (newest wins) and sort newest first.
 * @param {{path: string, time: number}[]} entries
 * @param {(path: string) => boolean} [exists]
 */
export function finish(entries, exists = isDir) {
    const best = new Map();
    for (const e of entries) {
        const prev = best.get(e.path);
        if (!prev || e.time > prev.time) best.set(e.path, e);
    }
    return [...best.values()].filter((e) => exists(e.path)).sort((a, b) => b.time - a.time);
}

/** Names of the sub-folders of `dir`; [] when it cannot be read. */
export function listDirNames(dir) {
    const names = [];
    try {
        const en = Gio.File.new_for_path(dir).enumerate_children(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            null,
        );
        for (let info = en.next_file(null); info !== null; info = en.next_file(null)) {
            if (info.get_file_type() === Gio.FileType.DIRECTORY) names.push(info.get_name());
        }
        en.close(null);
    } catch (_e) {
        return [];
    }
    return names.sort();
}

/** Modification time of a file in ms, or 0. */
export function mtimeMs(path) {
    try {
        const info = Gio.File.new_for_path(path).query_info(
            'time::modified',
            Gio.FileQueryInfoFlags.NONE,
            null,
        );
        return info.get_modification_date_time().to_unix() * 1000;
    } catch (_e) {
        return 0;
    }
}
