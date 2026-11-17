import {
    AUTO_TERMINAL_ORDER,
    autoTerminal,
    detectInstalled,
    EDITOR_PRESETS,
    TERMINAL_PRESETS,
} from '../extension/src/core/presets.js';
import { resolve, wrapInTerminal } from '../extension/src/core/template.js';
import { assert, test } from './harness.js';

const finder = (installed) => (bin) => (installed.includes(bin) ? `/usr/bin/${bin}` : null);

test('presets: detectInstalled marks installed editors', () => {
    const out = detectInstalled(EDITOR_PRESETS, finder(['code', 'zed']));
    assert.deepEqual(
        out.filter((p) => p.installed).map((p) => p.id),
        ['vscode', 'zed'],
    );
    assert.equal(out.length, EDITOR_PRESETS.length);
    assert.ok(!('installed' in EDITOR_PRESETS[0]));
});

test('presets: detectInstalled works for terminals', () => {
    const out = detectInstalled(TERMINAL_PRESETS, finder(['kgx']));
    assert.deepEqual(
        out.filter((p) => p.installed).map((p) => p.id),
        ['kgx'],
    );
});

test('presets: autoTerminal follows the fixed order', () => {
    assert.equal(autoTerminal(finder(['tilix', 'konsole'])).id, 'konsole');
    assert.equal(autoTerminal(finder(['gnome-terminal', 'kitty', 'ptyxis'])).id, 'ptyxis');
    assert.equal(autoTerminal(finder(['kgx', 'kitty', 'alacritty'])).id, 'kgx');
    assert.equal(autoTerminal(finder(['wezterm', 'ghostty'])).id, 'ghostty');
    assert.equal(autoTerminal(finder(['gnome-terminal'])).id, 'gnome-terminal');
    assert.equal(autoTerminal(finder([])), null);
});

test('presets: every ordered terminal id exists', () => {
    for (const id of AUTO_TERMINAL_ORDER) {
        assert.ok(
            TERMINAL_PRESETS.some((p) => p.id === id),
            id,
        );
    }
    assert.equal(AUTO_TERMINAL_ORDER.length, TERMINAL_PRESETS.length);
});

test('presets: editor remote templates', () => {
    const byId = Object.fromEntries(EDITOR_PRESETS.map((p) => [p.id, p]));
    assert.equal(byId.vscode.remoteTemplate, 'code --remote ssh-remote+{host} {remoteDir}');
    assert.equal(byId.zed.remoteTemplate, 'zed ssh://{host}{remoteDirUrl}');
    assert.equal(byId.pycharm.remoteTemplate, null);
    assert.deepEqual(resolve(byId.zed.remoteTemplate, { host: 'h', remoteDir: '~/app' }), [
        'zed',
        'ssh://h/~/app',
    ]);
});

test('presets: all templates resolve and terminals wrap a command', () => {
    for (const p of EDITOR_PRESETS) {
        const argv = resolve(p.projectTemplate, { path: '/a b' });
        assert.equal(argv[0], p.binary);
        if (p.remoteTemplate) resolve(p.remoteTemplate, { host: 'h', remoteDir: '/srv' });
    }
    for (const p of TERMINAL_PRESETS) {
        assert.equal(wrapInTerminal(p, '/a b', [])[0], p.binary);
        const run = wrapInTerminal(p, '/a b', ['ssh', 'h']);
        assert.equal(run[0], p.binary);
        assert.ok(run.includes('/a b') || run.some((a) => a.endsWith('/a b')));
    }
});
