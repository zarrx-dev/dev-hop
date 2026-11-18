import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { EDITOR_PRESETS, TERMINAL_PRESETS } from '../extension/src/core/presets.js';
import {
    addHost,
    deleteHost,
    listHosts,
    parse,
    serialize,
    updateHost,
} from '../extension/src/core/sshConfig.js';
import {
    acceleratorLabel,
    actionFromEditorPreset,
    actionFromTerminalPreset,
    buildAction,
    buildHostChange,
    ensureDefault,
    formatNameList,
    formToFields,
    hostSubtitle,
    insertAtCursor,
    moveItem,
    parseNameList,
    previewTemplate,
    programOf,
    recentSourceState,
    removeServerMeta,
    slugify,
    uniqueActionId,
    updateOverride,
    updateServerMeta,
    validateAccelerator,
    validateAction,
    validateAlias,
    validatePort,
} from '../extension/src/prefs/model.js';
import { applyChange, findBlockIndex } from '../extension/src/prefs/sshStore.js';
import { assert, test } from './harness.js';

// ---- alias and host form ---------------------------------------------------------------------

test('prefs: validateAlias accepts plain names', () => {
    assert.equal(validateAlias('staging', []), null);
    assert.equal(validateAlias('prod-web.2', ['staging']), null);
});

test('prefs: validateAlias refuses empty, spaces, wildcards and odd characters', () => {
    assert.ok(validateAlias('', []));
    assert.ok(validateAlias('   ', []));
    assert.ok(validateAlias('my host', []));
    assert.ok(validateAlias('web*', []));
    assert.ok(validateAlias('web?', []));
    assert.ok(validateAlias('!web', []));
    assert.ok(validateAlias('a"b', []));
    assert.ok(validateAlias('a#b', []));
    assert.ok(validateAlias('-oProxyCommand=x', []));
    assert.ok(validateAlias('a\nb', []));
});

test('prefs: validateAlias refuses duplicates but lets a host keep its own name', () => {
    assert.ok(validateAlias('staging', ['staging', 'prod']));
    assert.ok(validateAlias('STAGING', ['staging']));
    assert.equal(validateAlias('staging', ['staging', 'prod'], 'staging'), null);
    assert.ok(validateAlias('prod', ['staging', 'prod'], 'staging'));
});

test('prefs: validatePort', () => {
    assert.equal(validatePort(''), null);
    assert.equal(validatePort(' 22 '), null);
    assert.equal(validatePort('65535'), null);
    assert.ok(validatePort('0'));
    assert.ok(validatePort('65536'));
    assert.ok(validatePort('ssh'));
    assert.ok(validatePort('-1'));
});

test('prefs: formToFields trims and keeps only the known keywords', () => {
    const fields = formToFields({
        alias: 'x',
        HostName: ' example.com ',
        User: 'alex',
        Port: '',
        IdentityFile: '~/.ssh/id_ed25519',
        ProxyJump: ' jump ',
        Other: 'ignored',
    });
    assert.deepEqual(fields, {
        HostName: 'example.com',
        User: 'alex',
        Port: '',
        IdentityFile: '~/.ssh/id_ed25519',
        ProxyJump: 'jump',
    });
});

test('prefs: buildHostChange returns aliases and fields, or the first problem', () => {
    const ok = buildHostChange(
        { alias: ' web ', HostName: 'example.com', Port: '2222' },
        { taken: ['db'], restAliases: ['web2'] },
    );
    assert.ok(ok.ok);
    assert.deepEqual(ok.aliases, ['web', 'web2']);
    assert.equal(ok.fields.Port, '2222');

    const dup = buildHostChange({ alias: 'db' }, { taken: ['db'] });
    assert.ok(!dup.ok);
    assert.equal(dup.field, 'alias');

    const port = buildHostChange({ alias: 'new', Port: 'abc' }, { taken: [] });
    assert.equal(port.field, 'Port');

    const newline = buildHostChange({ alias: 'new', User: 'a\nProxyCommand evil' }, { taken: [] });
    assert.ok(!newline.ok);
    assert.equal(newline.field, 'User');

    const quote = buildHostChange({ alias: 'new', HostName: 'a"b' }, { taken: [] });
    assert.ok(!quote.ok);
});

test('prefs: hostSubtitle', () => {
    const entry = {
        aliases: ['staging'],
        fields: { HostName: 'staging.example.com', User: 'deploy', Port: '', ProxyJump: '' },
    };
    assert.equal(hostSubtitle(entry), 'deploy@staging.example.com');
    assert.equal(hostSubtitle(entry, '/srv/app'), 'deploy@staging.example.com  -  /srv/app');
    assert.equal(
        hostSubtitle({
            aliases: ['db'],
            fields: { HostName: 'b.example.com', User: 'ubuntu', Port: '2222', ProxyJump: 'web' },
        }),
        'ubuntu@b.example.com, port 2222  -  via web',
    );
    assert.equal(
        hostSubtitle({ aliases: ['solo'], fields: { HostName: '', User: '', Port: '' } }),
        'solo',
    );
});

// ---- server meta and overrides ---------------------------------------------------------------

test('prefs: updateServerMeta sets, renames and clears', () => {
    let meta = updateServerMeta({}, 'web', { remoteDir: '/srv/app', defaultAction: 'ssh' });
    assert.deepEqual(meta, { web: { remoteDir: '/srv/app', defaultAction: 'ssh' } });
    meta = updateServerMeta(meta, 'web', { rename: 'web2', remoteDir: '/srv/app' });
    assert.deepEqual(meta, { web2: { remoteDir: '/srv/app', defaultAction: 'ssh' } });
    meta = updateServerMeta(meta, 'web2', { remoteDir: '' });
    assert.deepEqual(meta, { web2: { defaultAction: 'ssh' } });
    meta = updateServerMeta(meta, 'web2', { defaultAction: '' });
    assert.deepEqual(meta, {});
    assert.deepEqual(updateServerMeta({ a: { remoteDir: '/x' } }, 'b', {}), {
        a: { remoteDir: '/x' },
    });
});

test('prefs: updateServerMeta is safe for odd alias names', () => {
    const meta = updateServerMeta({}, '__proto__', { remoteDir: '/x' });
    assert.equal(Object.getPrototypeOf(meta), null);
    assert.deepEqual(Object.keys(meta), ['__proto__']);
    assert.equal(JSON.parse(JSON.stringify(meta)).constructor, Object);
});

test('prefs: removeServerMeta', () => {
    assert.deepEqual(removeServerMeta({ a: { remoteDir: '/x' }, b: { remoteDir: '/y' } }, 'a'), {
        b: { remoteDir: '/y' },
    });
    assert.deepEqual(removeServerMeta(undefined, 'a'), {});
});

test('prefs: updateOverride keeps only what matters', () => {
    let o = updateOverride({}, '/home/alex/app', { defaultAction: 'zed' });
    assert.deepEqual(o, { '/home/alex/app': { defaultAction: 'zed' } });
    o = updateOverride(o, '/home/alex/app', { hidden: true });
    assert.deepEqual(o, { '/home/alex/app': { defaultAction: 'zed', hidden: true } });
    o = updateOverride(o, '/home/alex/app', { defaultAction: '' });
    assert.deepEqual(o, { '/home/alex/app': { hidden: true } });
    o = updateOverride(o, '/home/alex/app', { hidden: false });
    assert.deepEqual(o, {});
});

test('prefs: name lists', () => {
    assert.deepEqual(parseNameList(' node_modules, .cache ,, dist\nbuild, dist'), [
        'node_modules',
        '.cache',
        'dist',
        'build',
    ]);
    assert.deepEqual(parseNameList(''), []);
    assert.equal(formatNameList(['a', 'b']), 'a, b');
});

test('prefs: recentSourceState', () => {
    const env = (programs, dirs, sqliteOk) => ({
        findProgram: (b) => (programs.includes(b) ? `/usr/bin/${b}` : null),
        sqliteOk,
        dirExists: (d) => dirs.includes(d),
    });
    assert.deepEqual(recentSourceState('vscode', env(['code'], [], true)), {
        state: 'ok',
        found: '/usr/bin/code',
    });
    assert.equal(recentSourceState('vscode', env([], [], true)).state, 'not-installed');
    assert.equal(recentSourceState('vscode', env(['code'], [], false)).state, 'needs-sqlite');
    assert.equal(recentSourceState('vscode', env([], ['.config/Code'], true)).state, 'ok');
    assert.equal(recentSourceState('jetbrains', env(['idea'], [], false)).state, 'ok');
    assert.equal(recentSourceState('claude', env([], ['.claude/projects'], false)).state, 'ok');
    assert.equal(recentSourceState('unknown', env([], [], true)).state, 'not-installed');
});

// ---- actions ---------------------------------------------------------------------------------

test('prefs: action ids', () => {
    assert.equal(slugify('Open in VS Code!'), 'open-in-vs-code');
    assert.equal(slugify('   '), 'action');
    assert.equal(uniqueActionId('Zed', ['zed']), 'zed-2');
    assert.equal(uniqueActionId('Zed', ['zed', 'zed-2']), 'zed-3');
    assert.equal(uniqueActionId('Fresh', ['zed']), 'fresh');
});

test('prefs: validateAction', () => {
    assert.equal(
        validateAction({ name: 'Zed', template: 'zed {path}', runInTerminal: false }, 'project'),
        null,
    );
    assert.ok(
        validateAction({ name: '', template: 'zed {path}', runInTerminal: false }, 'project'),
    );
    assert.ok(
        validateAction({ name: 'x', template: 'zed {nope}', runInTerminal: false }, 'project'),
    );
    assert.ok(
        validateAction({ name: 'x', template: 'zed "open', runInTerminal: false }, 'project'),
    );
    assert.ok(validateAction({ name: 'x', template: '', runInTerminal: false }, 'project'));
    assert.equal(
        validateAction({ name: 'Term', template: '', runInTerminal: true }, 'project'),
        null,
    );
    assert.equal(
        validateAction(
            { name: 'Zed', template: 'zed ssh://{host}{remoteDirUrl}', runInTerminal: false },
            'server',
        ),
        null,
    );
});

test('prefs: previewTemplate and programOf', () => {
    assert.deepEqual(previewTemplate('code {path}', 'project').args, [
        'code',
        '/home/alex/code/acme-api',
    ]);
    assert.deepEqual(previewTemplate('ssh {host}', 'server').args, ['ssh', 'staging']);
    assert.equal(programOf('code {path}'), 'code');
    assert.equal(programOf(''), null);
    assert.equal(programOf('code {bad}'), null);
});

test('prefs: buildAction', () => {
    const a = buildAction(
        { name: ' Zed ', icon: '', template: ' zed {path} ', runInTerminal: false, cwd: '' },
        'zed',
    );
    assert.deepEqual(a, {
        id: 'zed',
        name: 'Zed',
        icon: 'application-x-executable-symbolic',
        template: 'zed {path}',
        runInTerminal: false,
        requiresRemoteDir: false,
        enabled: true,
    });
    const b = buildAction(
        { name: 'T', icon: 'x-symbolic', template: '', runInTerminal: true, cwd: '{path}/src' },
        't',
        false,
    );
    assert.equal(b.cwd, '{path}/src');
    assert.equal(b.enabled, false);
});

test('prefs: moveItem stays inside the list', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 1), ['a', 'b', 'c']);
});

test('prefs: preset actions match the default action ids and resolve', () => {
    const zed = EDITOR_PRESETS.find((p) => p.id === 'zed');
    assert.equal(actionFromEditorPreset(zed, 'project').id, 'zed');
    assert.equal(actionFromEditorPreset(zed, 'server').id, 'zed-remote');
    const sublime = EDITOR_PRESETS.find((p) => p.id === 'sublime');
    assert.equal(actionFromEditorPreset(sublime, 'server'), null);
    for (const p of EDITOR_PRESETS) {
        for (const kind of ['project', 'server']) {
            const action = actionFromEditorPreset(p, kind);
            if (action) assert.equal(validateAction(action, kind), null);
        }
    }
    for (const p of TERMINAL_PRESETS) {
        const action = actionFromTerminalPreset(p);
        assert.ok(!action.template.includes('{cwd}'));
        assert.equal(validateAction(action, 'project'), null);
        assert.equal(programOf(action.template), p.binary);
    }
});

test('prefs: ensureDefault', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    assert.equal(ensureDefault(list, 'b'), 'b');
    assert.equal(ensureDefault(list, 'gone'), 'a');
    assert.equal(ensureDefault([], 'a'), '');
});

test('prefs: insertAtCursor', () => {
    assert.deepEqual(insertAtCursor('code ', 5, '{path}'), { text: 'code {path}', position: 11 });
    assert.deepEqual(insertAtCursor('ab', 1, 'X'), { text: 'aXb', position: 2 });
    assert.deepEqual(insertAtCursor('ab', 99, 'X'), { text: 'abX', position: 3 });
});

// ---- shortcut --------------------------------------------------------------------------------

test('prefs: acceleratorLabel', () => {
    assert.equal(acceleratorLabel('<Super>j'), 'Super + J');
    assert.equal(acceleratorLabel('<Control><Alt>Return'), 'Ctrl + Alt + Return');
    assert.equal(acceleratorLabel('<Primary><Shift>space'), 'Ctrl + Shift + space');
    assert.equal(acceleratorLabel(''), '');
    assert.equal(acceleratorLabel('garbage'), 'garbage');
});

test('prefs: validateAccelerator', () => {
    assert.equal(validateAccelerator('<Super>j'), null);
    assert.equal(validateAccelerator('<Control><Alt>t'), null);
    assert.ok(validateAccelerator(''));
    assert.ok(validateAccelerator('j'));
    assert.ok(validateAccelerator('<Shift>j'));
    assert.ok(validateAccelerator('<Super>'));
    assert.ok(validateAccelerator('<Super>Shift_L'));
    assert.ok(validateAccelerator('<Bogus>j'));
});

// ---- ssh store: a copy in scratchpad, never the real config ----------------------------------

const TEST_FILE = GLib.filename_from_uri(import.meta.url)[0];
const REPO_ROOT = GLib.path_get_dirname(GLib.path_get_dirname(TEST_FILE));
const SCRATCH = GLib.build_filenamev([REPO_ROOT, 'scratchpad']);

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

function withTempConfig(text, fn) {
    GLib.mkdir_with_parents(SCRATCH, 0o755);
    const dir = `${SCRATCH}/prefs-${GLib.random_int()}`;
    GLib.mkdir_with_parents(dir, 0o755);
    const path = `${dir}/config`;
    GLib.file_set_contents(path, text);
    try {
        fn(path, dir);
    } finally {
        removeTree(dir);
    }
}

const read = (path) => new TextDecoder().decode(GLib.file_get_contents(path)[1]);

const SAMPLE = `# my hosts
Host staging
    HostName staging.example.com
    User deploy

Host db
    HostName db.example.com
`;

test('prefs: applyChange edits one host and keeps a backup of the old file', () => {
    withTempConfig(SAMPLE, (path, dir) => {
        const { backup } = applyChange(path, (model) => {
            const index = findBlockIndex(model, 'staging');
            updateHost(model, index, { User: 'alex', Port: '2222' });
        });
        assert.equal(read(backup), SAMPLE);
        assert.equal(read(path), SAMPLE.replace('User deploy', 'User alex\n    Port 2222'));
        assert.equal(GLib.path_get_dirname(backup), dir);
    });
});

test('prefs: applyChange applies to the fresh file, so outside edits survive', () => {
    withTempConfig(SAMPLE, (path) => {
        const stale = parse(read(path));
        GLib.file_set_contents(
            path,
            `${SAMPLE}\nHost added-elsewhere\n    HostName x.example.com\n`,
        );
        applyChange(path, (model) => {
            // The index comes from the fresh model, not from the stale one.
            deleteHost(model, findBlockIndex(model, 'db'));
        });
        const after = read(path);
        assert.ok(after.includes('added-elsewhere'));
        assert.ok(!after.includes('Host db'));
        assert.ok(after.includes('Host staging'));
        assert.equal(listHosts(stale).length, 2);
    });
});

test('prefs: applyChange adds a host and leaves the rest byte for byte', () => {
    withTempConfig(SAMPLE, (path) => {
        applyChange(path, (model) => addHost(model, ['new-box'], { HostName: 'n.example.com' }));
        const after = read(path);
        assert.ok(after.startsWith(SAMPLE));
        assert.equal(after.slice(SAMPLE.length), '\nHost new-box\n    HostName n.example.com\n');
    });
});

test('prefs: applyChange writes nothing when the change throws', () => {
    withTempConfig(SAMPLE, (path, dir) => {
        let threw = false;
        try {
            applyChange(path, (model) => {
                if (findBlockIndex(model, 'gone') < 0) throw new Error('gone');
            });
        } catch (_e) {
            threw = true;
        }
        assert.ok(threw);
        assert.equal(read(path), SAMPLE);
        const names = [];
        const en = Gio.File.new_for_path(dir).enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null,
        );
        for (let i = en.next_file(null); i !== null; i = en.next_file(null))
            names.push(i.get_name());
        assert.deepEqual(names, ['config']);
    });
});

test('prefs: findBlockIndex skips pattern blocks and unknown aliases', () => {
    const model = parse('Host *\n    User x\n\nHost real\n    HostName r\n');
    assert.equal(findBlockIndex(model, 'real'), 1);
    assert.equal(findBlockIndex(model, 'nope'), -1);
    assert.equal(serialize(model).length > 0, true);
});
