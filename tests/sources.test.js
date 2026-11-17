import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { expandHome, getJSON, setJSON, setLogger } from '../extension/src/settings.js';
import { scanRepos } from '../extension/src/sources/gitScan.js';
import { mergeProjects, SourceManager } from '../extension/src/sources/manager.js';
import { loadPinned } from '../extension/src/sources/pinned.js';
import { extractCwd } from '../extension/src/sources/recent/claudeCode.js';
import { parseRecentProjects } from '../extension/src/sources/recent/jetbrains.js';
import { parseRecentlyOpened } from '../extension/src/sources/recent/vscodeFamily.js';
import { parseWorkspaces } from '../extension/src/sources/recent/zed.js';
import { loadServers } from '../extension/src/sources/servers.js';
import { assert, test } from './harness.js';
import {
    FakeSettings,
    fixture,
    makeDir,
    REPO_ROOT,
    removeTree,
    SCRATCH,
    writeFile,
} from './helpers.js';

// settings.js

test('settings: expandHome', () => {
    assert.equal(expandHome('~', '/home/alex'), '/home/alex');
    assert.equal(expandHome('~/code', '/home/alex'), '/home/alex/code');
    assert.equal(expandHome('/srv/x~', '/home/alex'), '/srv/x~');
});

test('settings: getJSON parses, falls back to the schema default on bad JSON, warns once', () => {
    const dir = `${REPO_ROOT}/extension/schemas`;
    if (!GLib.file_test(`${dir}/gschemas.compiled`, GLib.FileTest.EXISTS)) {
        GLib.spawn_command_line_sync(`glib-compile-schemas ${dir}`);
    }
    const source = Gio.SettingsSchemaSource.new_from_directory(
        dir,
        Gio.SettingsSchemaSource.get_default(),
        false,
    );
    const schema = source.lookup('org.gnome.shell.extensions.dev-hop', false);
    const settings = new Gio.Settings({
        settings_schema: schema,
        backend: Gio.memory_settings_backend_new(),
        path: '/org/gnome/shell/extensions/dev-hop/',
    });
    setJSON(settings, 'pinned', [{ path: '/home/alex/code/app' }]);
    assert.deepEqual(getJSON(settings, 'pinned'), [{ path: '/home/alex/code/app' }]);

    const warnings = [];
    setLogger((m) => warnings.push(m));
    try {
        settings.set_string('search-roots', '{not json');
        assert.deepEqual(getJSON(settings, 'search-roots'), ['~']);
    } finally {
        setLogger();
    }
    assert.equal(warnings.length, 1);
});

test('settings: getJSON uses the given fallback when there is no schema', () => {
    setLogger(() => {});
    try {
        const s = new FakeSettings({ pinned: 'oops' });
        assert.deepEqual(getJSON(s, 'pinned', '[]'), []);
    } finally {
        setLogger();
    }
});

// pinned

test('pinned: keeps order, drops missing paths, names by basename', () => {
    const s = new FakeSettings({
        pinned: JSON.stringify([
            { path: '/home/alex/code/b' },
            { path: '/home/alex/gone' },
            { path: '/home/alex/code/a/' },
            { nope: 1 },
        ]),
    });
    const out = loadPinned(s, { exists: (p) => !p.endsWith('gone') });
    assert.deepEqual(
        out.map((i) => [i.path, i.name, i.source, i.kind]),
        [
            ['/home/alex/code/b', 'b', 'pinned', 'project'],
            ['/home/alex/code/a/', 'a', 'pinned', 'project'],
        ],
    );
});

// recent readers

test('vscode: parses folders, skips remote, file and workspace entries', () => {
    const out = parseRecentlyOpened(fixture('vscode-recently-opened.json'), 100000);
    assert.deepEqual(
        out.map((e) => e.path),
        ['/home/alex/code/app', '/home/alex/my projects/site', '/home/alex/code/api'],
    );
    assert.ok(out[0].time > out[1].time && out[1].time > out[2].time, 'newest first');
    assert.deepEqual(parseRecentlyOpened('not json'), []);
    assert.deepEqual(parseRecentlyOpened('{}'), []);
});

test('zed: one item per path in a multi-path workspace', () => {
    const out = parseWorkspaces([
        { paths: '/home/alex/code/app\n/home/alex/code/lib', timestamp: '2025-03-02 10:00:00' },
        { paths: '/home/alex/code/old', timestamp: '2025-01-01 08:30:00' },
        { paths: null, timestamp: '2025-01-01 08:30:00' },
    ]);
    assert.deepEqual(
        out.map((e) => e.path),
        ['/home/alex/code/app', '/home/alex/code/lib', '/home/alex/code/old'],
    );
    assert.equal(out[0].time, Date.UTC(2025, 2, 2, 10, 0, 0));
    assert.equal(out[0].time, out[1].time);
});

test('jetbrains: parses the realistic fixture', () => {
    const out = parseRecentProjects(fixture('jetbrains-recentProjects.xml'), '/home/alex', 5);
    assert.deepEqual(out, [
        { path: '/home/alex/code/app', time: 1731800000000 },
        { path: '/opt/work/legacy & co', time: 1731900000000 },
        { path: '/home/alex/code/no-timestamp', time: 5 },
    ]);
    assert.deepEqual(parseRecentProjects('<application/>', '/home/alex'), []);
});

test('claude code: finds cwd on a later line, ignores a cut-off last line', () => {
    assert.equal(extractCwd(fixture('claude-session.jsonl')), '/home/alex/code/app');
    assert.equal(extractCwd('{"type":"summary"}\n{"cwd":"/home/alex/x","ty'), null);
    assert.equal(extractCwd('{"cwd":42}\n{"cwd":"/home/alex/y"}'), '/home/alex/y');
});

// servers

test('servers: merges server-meta, includes read-only hosts, missing file gives []', () => {
    const files = {
        '/home/alex/.ssh/config':
            'Include conf.d/*\nHost web\n  HostName 10.0.0.5\n  User deploy\n  Port 2222\n\nHost *\n  ForwardAgent no\n',
        '/home/alex/.ssh/conf.d/extra': 'Host db\n  HostName db.internal\n',
    };
    const s = new FakeSettings({
        'server-meta': JSON.stringify({
            web: { remoteDir: '/srv/app', defaultAction: 'zed-remote' },
        }),
    });
    const out = loadServers(s, {
        home: '/home/alex',
        readFile: (p) => files[p] ?? null,
        listDir: (dir) => (dir === '/home/alex/.ssh/conf.d' ? ['extra'] : []),
    });
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], {
        kind: 'server',
        host: 'web',
        aliases: ['web'],
        user: 'deploy',
        hostName: '10.0.0.5',
        port: '2222',
        editable: true,
        source: null,
        blockIndex: 0,
        remoteDir: '/srv/app',
        defaultAction: 'zed-remote',
    });
    assert.equal(out[1].host, 'db');
    assert.equal(out[1].editable, false);
    assert.equal(out[1].blockIndex, null);
    assert.equal(out[1].remoteDir, '');
    assert.deepEqual(loadServers(s, { home: '/home/alex', readFile: () => null }), []);
});

// git scan

function buildTree(root) {
    removeTree(root);
    const gitDir = (p) => makeDir(`${root}/${p}/.git`);
    gitDir('app');
    gitDir('app/packages/inner');
    gitDir('node_modules/dep');
    gitDir('lvl/one/repo2');
    gitDir('deep/a/b/c/repo');
    gitDir('.hidden/repo3');
    gitDir('vendor/x');
    writeFile(`${root}/wt/.git`, 'gitdir: /somewhere/.git/worktrees/wt\n');
    gitDir('real-target');
    makeDir(`${root}/../${GLib.path_get_basename(root)}-outside/linked/.git`);
    Gio.File.new_for_path(`${root}/ln`).make_symbolic_link(
        `${root}/../${GLib.path_get_basename(root)}-outside/linked`,
        null,
    );
}

const names = (items) => items.map((i) => i.name).sort();

test('git scan: repos, nested, skip dirs, dot folders, symlinks, worktrees, depth', async () => {
    const root = `${SCRATCH}/gitscan-tree`;
    buildTree(root);
    try {
        const base = { roots: [root], skipDirs: ['node_modules', 'vendor'] };

        const d3 = await scanRepos({ ...base, depth: 3 });
        assert.deepEqual(names(d3), ['app', 'real-target', 'repo2']);
        assert.ok(
            d3.every((i) => i.source === 'git' && i.worktree === false && i.kind === 'project'),
        );

        const d5 = await scanRepos({ ...base, depth: 5 });
        assert.deepEqual(names(d5), ['app', 'real-target', 'repo', 'repo2']);

        const withWt = await scanRepos({ ...base, depth: 3, includeWorktrees: true });
        assert.deepEqual(names(withWt), ['app', 'real-target', 'repo2', 'wt']);
        assert.equal(withWt.find((i) => i.name === 'wt').worktree, true);

        const capped = await scanRepos({ ...base, depth: 5, maxRepos: 2 });
        assert.equal(capped.length, 2);

        const cancellable = new Gio.Cancellable();
        cancellable.cancel();
        assert.deepEqual(await scanRepos({ ...base, depth: 5, cancellable }), []);

        assert.deepEqual(await scanRepos({ roots: [`${root}/missing`], depth: 3 }), []);
    } finally {
        removeTree(root);
        removeTree(`${root}-outside`);
    }
});

test('git scan: a root that is itself a repo is listed', async () => {
    const root = `${SCRATCH}/gitscan-self`;
    removeTree(root);
    makeDir(`${root}/.git`);
    try {
        const out = await scanRepos({ roots: [root], depth: 2 });
        assert.deepEqual(names(out), ['gitscan-self']);
    } finally {
        removeTree(root);
    }
});

// merge

const proj = (path, extra = {}) => ({
    kind: 'project',
    path,
    name: path.split('/').pop(),
    ...extra,
});

test('merge: order, dedupe, overrides and the recent cap', () => {
    const out = mergeProjects({
        pinned: [proj('/w/a', { source: 'pinned' })],
        recent: [
            {
                label: 'VS Code',
                entries: [
                    { path: '/w/b', time: 5 },
                    { path: '/w/a', time: 9 },
                    { path: '/w/c', time: 3 },
                ],
            },
            {
                label: 'Cursor',
                entries: [
                    { path: '/w/b', time: 7 },
                    { path: '/w/d', time: 1 },
                ],
            },
        ],
        git: [
            proj('/w/z', { source: 'git' }),
            proj('/w/c', { source: 'git' }),
            proj('/w/e', { source: 'git' }),
            proj('/w/link-to-a', { source: 'git' }),
            proj('/w/m', { source: 'git' }),
        ],
        overrides: { '/w/z': { hidden: true }, '/w/e': { defaultAction: 'zed' } },
        maxRecent: 2,
        canonicalize: (p) => (p === '/w/link-to-a' ? '/w/a' : p),
    });
    assert.deepEqual(
        out.map((i) => `${i.source}:${i.path}`),
        ['pinned:/w/a', 'recent:/w/b', 'recent:/w/c', 'git:/w/e', 'git:/w/m'],
    );
    assert.equal(out[1].recentFrom, 'Cursor');
    assert.equal(out[2].recentFrom, 'VS Code');
    assert.equal(out[3].defaultAction, 'zed');
});

test('merge: a hidden pinned item does not reappear from another group', () => {
    const out = mergeProjects({
        pinned: [proj('/w/a', { source: 'pinned' })],
        recent: [{ label: 'Zed', entries: [{ path: '/w/a', time: 1 }] }],
        git: [proj('/w/a', { source: 'git' })],
        overrides: { '/w/a': { hidden: true } },
        maxRecent: 8,
    });
    assert.equal(out.length, 0);
});

// manager

function makeManager(extra = {}) {
    const settings = new FakeSettings({
        'recent-sources': JSON.stringify({ vscode: true, zed: true, jetbrains: false }),
        'max-recent': 3,
        ...extra.values,
    });
    const calls = { git: 0, vscode: 0, zed: 0, jetbrains: 0 };
    let clock = 0;
    const deps = {
        readers: [
            {
                id: 'vscode',
                label: 'VS Code',
                read: async () => {
                    calls.vscode++;
                    return [{ path: '/w/r1', time: 10 }];
                },
            },
            {
                id: 'zed',
                label: 'Zed',
                read: async () => {
                    calls.zed++;
                    return [{ path: '/w/r2', time: 20 }];
                },
            },
            {
                id: 'jetbrains',
                label: 'JetBrains',
                read: async () => {
                    calls.jetbrains++;
                    return [{ path: '/w/r3', time: 30 }];
                },
            },
        ],
        scanGit: async () => {
            calls.git++;
            return [proj('/w/g', { source: 'git' })];
        },
        loadPinned: () => [proj('/w/p', { source: 'pinned' })],
        loadServers: () => [{ kind: 'server', host: 'web' }],
        canonicalize: (p) => p,
        now: () => clock,
        ...extra.deps,
    };
    const manager = new SourceManager(settings, deps);
    return {
        manager,
        settings,
        calls,
        advance: (ms) => {
            clock += ms;
        },
    };
}

const nextChanged = (manager) =>
    new Promise((resolve) => {
        const id = manager.connect('changed', () => {
            manager.disconnect(id);
            resolve();
        });
    });

test('manager: refresh merges enabled sources, fires changed, serves servers', async () => {
    const { manager, calls } = makeManager();
    let fired = 0;
    manager.connect('changed', () => fired++);
    await manager.refresh();
    assert.deepEqual(
        manager.getProjects().map((p) => p.path),
        ['/w/p', '/w/r2', '/w/r1', '/w/g'],
    );
    assert.equal(manager.getProjects()[1].recentFrom, 'Zed');
    assert.equal(calls.jetbrains, 0, 'disabled source is not read');
    assert.equal(fired, 1);
    assert.deepEqual(
        manager.getServers().map((s) => s.host),
        ['web'],
    );
    manager.destroy();
});

test('manager: caches for a minute unless forced', async () => {
    const { manager, calls, advance } = makeManager();
    await manager.refresh();
    await manager.refresh();
    assert.equal(calls.git, 1);
    advance(59000);
    await manager.refresh();
    assert.equal(calls.git, 1);
    advance(2000);
    await manager.refresh();
    assert.equal(calls.git, 2);
    await manager.refresh({ force: true });
    assert.equal(calls.git, 3);
    manager.destroy();
});

test('manager: a forced refresh supersedes one in progress', async () => {
    let release;
    const gate = new Promise((r) => {
        release = r;
    });
    let n = 0;
    const { manager } = makeManager({
        deps: {
            scanGit: async () => {
                n++;
                if (n === 1) {
                    await gate;
                    return [proj('/w/stale', { source: 'git' })];
                }
                return [proj('/w/fresh', { source: 'git' })];
            },
        },
    });
    const first = manager.refresh();
    const second = manager.refresh({ force: true });
    release();
    await Promise.all([first, second]);
    const paths = manager.getProjects().map((p) => p.path);
    assert.ok(paths.includes('/w/fresh') && !paths.includes('/w/stale'));
    manager.destroy();
});

test('manager: settings changes refresh or rebuild; destroy disconnects', async () => {
    const { manager, settings, calls } = makeManager();
    await manager.refresh();
    assert.equal(calls.git, 1);

    const heavy = nextChanged(manager);
    settings.set('scan-depth', 2);
    await heavy;
    assert.equal(calls.git, 2);

    settings.set('item-overrides', JSON.stringify({ '/w/g': { hidden: true } }));
    assert.equal(calls.git, 2, 'light keys do not rescan');
    assert.ok(!manager.getProjects().some((p) => p.path === '/w/g'));

    manager.destroy();
    assert.equal(settings.handlers.size, 0);
    await manager.refresh({ force: true });
    assert.equal(calls.git, 2);
});

test('manager: a failing source does not break the others', async () => {
    const warnings = [];
    setLogger((m) => warnings.push(m));
    try {
        const { manager } = makeManager({
            deps: {
                scanGit: async () => {
                    throw new Error('boom');
                },
            },
        });
        await manager.refresh();
        assert.deepEqual(
            manager.getProjects().map((p) => p.path),
            ['/w/p', '/w/r2', '/w/r1'],
        );
        assert.equal(warnings.length, 1);
        manager.destroy();
    } finally {
        setLogger();
    }
});
