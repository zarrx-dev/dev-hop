// Small path helpers shared by the sources.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function isDir(path) {
    return GLib.file_test(path, GLib.FileTest.IS_DIR);
}

export function baseName(path) {
    const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
    return GLib.path_get_basename(trimmed);
}

/**
 * Absolute path with `..` and symlinks resolved, component by component. Falls back to the
 * lexically cleaned path for parts that do not exist.
 * @param {string} path
 * @returns {string}
 */
export function realPath(path) {
    const clean = GLib.canonicalize_filename(path, null);
    let todo = clean.split('/').filter(Boolean);
    let resolved = '/';
    let links = 0;
    while (todo.length > 0) {
        const comp = todo.shift();
        const next = resolved === '/' ? `/${comp}` : `${resolved}/${comp}`;
        let target = null;
        try {
            const info = Gio.File.new_for_path(next).query_info(
                'standard::is-symlink,standard::symlink-target',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                null,
            );
            if (info.get_is_symlink()) target = info.get_symlink_target();
        } catch (_e) {
            return [next, ...todo].join('/').replace(/^\/*/, '/');
        }
        if (target === null) {
            resolved = next;
            continue;
        }
        if (++links > 40) return clean;
        const abs = GLib.canonicalize_filename(target, resolved);
        todo = [...abs.split('/').filter(Boolean), ...todo];
        resolved = '/';
    }
    return resolved;
}
