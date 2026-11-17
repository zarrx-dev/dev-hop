import { availableActions, buildCommand, terminalPreset } from '../extension/src/actions/runner.js';
import { assert, test } from './harness.js';
import { FakeSettings } from './helpers.js';

const finder = (installed) => (bin) => (installed.includes(bin) ? `/usr/bin/${bin}` : null);

const projectActions = [
    { id: 'terminal', name: 'Terminal', template: '', runInTerminal: true, enabled: true },
    { id: 'claude', name: 'Claude', template: 'claude', runInTerminal: true, enabled: true },
    { id: 'zed', name: 'Zed', template: 'zed {path}', runInTerminal: false, enabled: true },
    { id: 'vscode', name: 'Code', template: 'code {path}', runInTerminal: false, enabled: true },
    { id: 'off', name: 'Off', template: 'zed {path}', runInTerminal: false, enabled: false },
];

const serverActions = [
    { id: 'ssh', name: 'SSH', template: 'ssh {host}', runInTerminal: true, enabled: true },
    {
        id: 'ssh-folder',
        name: 'SSH to folder',
        template: 'ssh -t {host} {remoteCmd}',
        runInTerminal: true,
        requiresRemoteDir: true,
        enabled: true,
    },
    {
        id: 'zed-remote',
        name: 'Zed remote',
        template: 'zed ssh://{host}{remoteDirUrl}',
        runInTerminal: false,
        requiresRemoteDir: true,
        enabled: true,
    },
];

const settingsWith = (values = {}) =>
    new FakeSettings({
        'project-actions': JSON.stringify(projectActions),
        'server-actions': JSON.stringify(serverActions),
        'default-project-action': 'terminal',
        'default-server-action': 'ssh',
        ...values,
    });

const project = { kind: 'project', path: '/home/alex/code/app', name: 'app' };
const server = { kind: 'server', host: 'web', user: 'deploy', remoteDir: '' };
const everything = finder(['gnome-terminal', 'claude', 'zed', 'code', 'ssh']);

test('runner: availableActions hides disabled and uninstalled actions', () => {
    const s = settingsWith();
    const all = availableActions(s, 'project', project, everything);
    assert.deepEqual(
        all.map((a) => a.id),
        ['terminal', 'claude', 'zed', 'vscode'],
    );
    const noCode = availableActions(s, 'project', project, finder(['gnome-terminal', 'zed']));
    assert.deepEqual(
        noCode.map((a) => a.id),
        ['terminal', 'zed'],
    );
});

test('runner: terminal actions are hidden when no terminal is installed', () => {
    const s = settingsWith();
    const out = availableActions(s, 'project', project, finder(['claude', 'zed']));
    assert.deepEqual(
        out.map((a) => a.id),
        ['zed'],
    );
});

test('runner: requiresRemoteDir hides actions for a server without one', () => {
    const s = settingsWith();
    assert.deepEqual(
        availableActions(s, 'server', server, everything).map((a) => a.id),
        ['ssh'],
    );
    const withDir = { ...server, remoteDir: '/srv/app' };
    assert.deepEqual(
        availableActions(s, 'server', withDir, everything).map((a) => a.id),
        ['ssh', 'ssh-folder', 'zed-remote'],
    );
});

test('runner: isDefault follows the item override, then the setting, then the first', () => {
    const s = settingsWith();
    const defaultOf = (item, finderFn = everything, kind = 'project') =>
        availableActions(s, kind, item, finderFn).find((a) => a.isDefault)?.id;
    assert.equal(defaultOf(project), 'terminal');
    assert.equal(defaultOf({ ...project, defaultAction: 'zed' }), 'zed');
    assert.equal(defaultOf({ ...project, defaultAction: 'missing' }), 'terminal');
    assert.equal(
        defaultOf(project, finder(['zed'])),
        'zed',
        'first available when default is hidden',
    );
    assert.equal(
        availableActions(s, 'project', project, everything).filter((a) => a.isDefault).length,
        1,
    );
});

test('runner: terminalPreset uses the setting when installed, else the auto choice', () => {
    const s = settingsWith({ 'terminal-preset': 'kitty' });
    assert.equal(terminalPreset(s, finder(['kitty', 'gnome-terminal'])).id, 'kitty');
    assert.equal(terminalPreset(s, finder(['gnome-terminal'])).id, 'gnome-terminal');
    assert.equal(terminalPreset(s, finder([])), null);
});

test('runner: buildCommand for a plain terminal action', () => {
    const s = settingsWith();
    const cmd = buildCommand(s, 'project', project, projectActions[0], everything);
    assert.deepEqual(cmd, {
        argv: ['gnome-terminal', '--working-directory=/home/alex/code/app'],
        cwd: '/home/alex/code/app',
    });
});

test('runner: buildCommand for a terminal action that runs a command', () => {
    const s = settingsWith();
    const cmd = buildCommand(s, 'project', project, projectActions[1], everything);
    assert.deepEqual(cmd.argv, [
        'gnome-terminal',
        '--working-directory=/home/alex/code/app',
        '--',
        'claude',
    ]);
});

test('runner: buildCommand for an editor action', () => {
    const s = settingsWith();
    const cmd = buildCommand(s, 'project', project, projectActions[2], everything);
    assert.deepEqual(cmd, { argv: ['zed', '/home/alex/code/app'], cwd: '/home/alex/code/app' });
});

test('runner: buildCommand for SSH to a folder keeps the folder quoted in one argument', () => {
    const s = settingsWith();
    const item = { ...server, remoteDir: '/srv/my app' };
    const cmd = buildCommand(s, 'server', item, serverActions[1], everything);
    assert.deepEqual(cmd.argv, [
        'gnome-terminal',
        `--working-directory=${cmd.cwd}`,
        '--',
        'ssh',
        '-t',
        'web',
        `cd '/srv/my app'; exec "$SHELL" -l`,
    ]);
    assert.ok(cmd.cwd.startsWith('/'));
});

test('runner: buildCommand for a Zed remote action', () => {
    const s = settingsWith();
    const item = { ...server, remoteDir: '/srv/app' };
    const cmd = buildCommand(s, 'server', item, serverActions[2], everything);
    assert.deepEqual(cmd.argv, ['zed', 'ssh://web/srv/app']);
});

test('runner: buildCommand throws for a terminal action without a terminal', () => {
    const s = settingsWith();
    assert.throws(() => buildCommand(s, 'project', project, projectActions[0], finder([])));
});
