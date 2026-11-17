// Test helpers: a fake GSettings, fixture access and file tree utilities.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const here = Gio.File.new_for_uri(import.meta.url).get_parent();

export const REPO_ROOT = here.get_parent().get_path();
export const SCRATCH = `${REPO_ROOT}/scratchpad`;

export function fixture(name) {
    const [, bytes] = GLib.file_get_contents(`${here.get_path()}/fixtures/${name}`);
    return new TextDecoder().decode(bytes);
}

/** Just enough of Gio.Settings for the sources and the runner. */
export class FakeSettings {
    constructor(values = {}) {
        this.values = {
            pinned: '[]',
            'search-roots': '[]',
            'scan-depth': 4,
            'skip-dirs': '[]',
            'recent-sources': '{}',
            'max-recent': 8,
            'include-worktrees': false,
            'project-actions': '[]',
            'server-actions': '[]',
            'default-project-action': '',
            'default-server-action': '',
            'server-meta': '{}',
            'item-overrides': '{}',
            'terminal-preset': '',
            'ssh-config-path': '~/.ssh/config',
            ...values,
        };
        this.handlers = new Map();
        this.nextId = 1;
    }

    get_string(key) {
        return this.values[key];
    }

    get_int(key) {
        return this.values[key];
    }

    get_boolean(key) {
        return this.values[key];
    }

    set_string(key, value) {
        this.values[key] = value;
        this.fire(key);
        return true;
    }

    set(key, value) {
        this.values[key] = value;
        this.fire(key);
    }

    fire(key) {
        for (const h of [...this.handlers.values()]) {
            if (h.signal === `changed::${key}`) h.cb();
        }
    }

    connect(signal, cb) {
        const id = this.nextId++;
        this.handlers.set(id, { signal, cb });
        return id;
    }

    disconnect(id) {
        this.handlers.delete(id);
    }
}

export function makeDir(path) {
    GLib.mkdir_with_parents(path, 0o755);
}

export function writeFile(path, text = '') {
    makeDir(GLib.path_get_dirname(path));
    GLib.file_set_contents(path, text);
}

export function removeTree(path) {
    const file = Gio.File.new_for_path(path);
    let info;
    try {
        info = file.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch (_e) {
        return;
    }
    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
        const en = file.enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null,
        );
        for (let i = en.next_file(null); i !== null; i = en.next_file(null)) {
            removeTree(`${path}/${i.get_name()}`);
        }
        en.close(null);
    }
    file.delete(null);
}
