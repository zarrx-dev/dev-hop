import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { backupName, writeWithBackup } from '../extension/src/core/sshConfigFile.js';
import { assert, test } from './harness.js';

const TEST_FILE = GLib.filename_from_uri(import.meta.url)[0];
const REPO_ROOT = GLib.path_get_dirname(GLib.path_get_dirname(TEST_FILE));
const SCRATCH = GLib.build_filenamev([REPO_ROOT, 'scratchpad']);
GLib.mkdir_with_parents(SCRATCH, 0o755);

function removeTree(path) {
    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null)) return;
    if (
        file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) ===
        Gio.FileType.DIRECTORY
    ) {
        const en = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        for (let i = en.next_file(null); i !== null; i = en.next_file(null)) {
            removeTree(`${path}/${i.get_name()}`);
        }
        en.close(null);
    }
    file.delete(null);
}

function withTempDir(fn) {
    GLib.mkdir_with_parents(SCRATCH, 0o755);
    const dir = `${SCRATCH}/sshfile-${GLib.random_int()}`;
    GLib.mkdir_with_parents(dir, 0o755);
    try {
        fn(dir);
    } finally {
        removeTree(dir);
    }
}

const read = (path) => new TextDecoder().decode(GLib.file_get_contents(path)[1]);
const mode = (path) =>
    Gio.File.new_for_path(path)
        .query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
        .get_attribute_uint32('unix::mode') & 0o777;
const names = (dir) => {
    const out = [];
    const en = Gio.File.new_for_path(dir).enumerate_children(
        'standard::name',
        Gio.FileQueryInfoFlags.NONE,
        null,
    );
    for (let i = en.next_file(null); i !== null; i = en.next_file(null)) out.push(i.get_name());
    en.close(null);
    return out.sort();
};

test('sshConfigFile: backupName format', () => {
    assert.equal(backupName(new Date(2026, 10, 7, 9, 5, 3)), 'config.20261107-090503.bak');
});

test('sshConfigFile: backs up the old file and writes the new one with mode 600', () => {
    withTempDir((dir) => {
        const path = `${dir}/config`;
        GLib.file_set_contents(path, 'Host old\n');
        GLib.chmod(path, 0o644);
        const now = new Date(2026, 10, 17, 12, 30, 45);
        const { backup } = writeWithBackup(path, 'Host new\n', now);
        assert.equal(backup, `${dir}/config.20261117-123045.bak`);
        assert.equal(read(backup), 'Host old\n');
        assert.equal(read(path), 'Host new\n');
        assert.equal(mode(path), 0o600);
        assert.equal(mode(backup), 0o600);
        assert.deepEqual(names(dir), ['config', 'config.20261117-123045.bak']);
    });
});

test('sshConfigFile: creates a missing file with mode 600 and no backup', () => {
    withTempDir((dir) => {
        const path = `${dir}/config`;
        const { backup } = writeWithBackup(path, 'Host a\n', new Date());
        assert.equal(backup, null);
        assert.equal(read(path), 'Host a\n');
        assert.equal(mode(path), 0o600);
        assert.deepEqual(names(dir), ['config']);
    });
});

test('sshConfigFile: creates a missing folder with mode 700', () => {
    withTempDir((dir) => {
        const path = `${dir}/.ssh/config`;
        writeWithBackup(path, 'Host a\n', new Date());
        assert.equal(read(path), 'Host a\n');
        assert.equal(mode(`${dir}/.ssh`), 0o700);
    });
});
