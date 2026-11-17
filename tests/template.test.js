import { resolve, toCmdline, wrapInTerminal } from '../extension/src/core/template.js';
import { assert, test } from './harness.js';

test('template: splits quoted arguments', () => {
    assert.deepEqual(resolve('foo "a b" \'c d\' e', {}), ['foo', 'a b', 'c d', 'e']);
});

test('template: empty and whitespace templates give an empty argv', () => {
    assert.deepEqual(resolve(''), []);
    assert.deepEqual(resolve('   \t '), []);
});

test('template: a path with spaces stays one argument', () => {
    assert.deepEqual(resolve('code {path}', { path: '/home/me/my project' }), [
        'code',
        '/home/me/my project',
    ]);
});

test('template: placeholders inside an argument', () => {
    assert.deepEqual(
        resolve('ssh {user}@{host} --name={name}', { user: 'u', host: 'h', name: 'n' }),
        ['ssh', 'u@h', '--name=n'],
    );
});

test('template: shell syntax inside a value stays literal in one argument', () => {
    assert.deepEqual(resolve('tool {path}', { path: '$(rm -rf ~)' }), ['tool', '$(rm -rf ~)']);
    assert.deepEqual(resolve('tool {path}', { path: 'a; b && c | d `e`' }), [
        'tool',
        'a; b && c | d `e`',
    ]);
    assert.deepEqual(resolve('tool {path}', { path: 'it\'s "q"' }), ['tool', 'it\'s "q"']);
});

test('template: values are not re-scanned for placeholders', () => {
    assert.deepEqual(resolve('x {path}', { path: '{host}', host: 'h' }), ['x', '{host}']);
});

test('template: unknown placeholder throws an error naming it', () => {
    let message = '';
    try {
        resolve('code {nope}', {});
    } catch (e) {
        message = e.message;
    }
    assert.ok(message.includes('{nope}'), `message was "${message}"`);
});

test('template: parse error throws a readable message', () => {
    let message = '';
    try {
        resolve('code "unterminated', {});
    } catch (e) {
        message = e.message;
    }
    assert.ok(message.startsWith('Cannot parse command template'), `message was "${message}"`);
    assert.ok(message.includes('unterminated'));
});

test('template: remoteCmd for ~', () => {
    assert.deepEqual(resolve('ssh -t {host} {remoteCmd}', { host: 'h', remoteDir: '~' }), [
        'ssh',
        '-t',
        'h',
        'cd ~; exec "$SHELL" -l',
    ]);
});

test('template: remoteCmd keeps a leading ~/ unquoted', () => {
    assert.deepEqual(resolve('{remoteCmd}', { remoteDir: '~/deployments' }), [
        'cd ~/\'deployments\'; exec "$SHELL" -l',
    ]);
});

test('template: remoteCmd quotes a path with spaces', () => {
    assert.deepEqual(resolve('{remoteCmd}', { remoteDir: '/srv/my app' }), [
        'cd \'/srv/my app\'; exec "$SHELL" -l',
    ]);
});

test('template: remoteCmd escapes a single quote in the folder', () => {
    assert.deepEqual(resolve('{remoteCmd}', { remoteDir: "/srv/it's" }), [
        "cd '/srv/it'\\''s'; exec \"$SHELL\" -l",
    ]);
    assert.deepEqual(resolve('{remoteCmd}', { remoteDir: "~/it's" }), [
        "cd ~/'it'\\''s'; exec \"$SHELL\" -l",
    ]);
});

test('template: remoteCmd without a folder just starts the shell', () => {
    assert.deepEqual(resolve('{remoteCmd}', {}), ['exec "$SHELL" -l']);
});

test('template: remoteDirUrl adds a leading slash only when missing', () => {
    assert.deepEqual(resolve('zed ssh://{host}{remoteDirUrl}', { host: 'h', remoteDir: '~/app' }), [
        'zed',
        'ssh://h/~/app',
    ]);
    assert.deepEqual(resolve('{remoteDirUrl}', { remoteDir: '/srv/app' }), ['/srv/app']);
});

test('template: toCmdline shell-quotes each argument', () => {
    assert.equal(toCmdline(['ssh', 'a b', "it's"]), "'ssh' 'a b' 'it'\\''s'");
});

const GNOME = {
    open: 'gnome-terminal --working-directory={cwd}',
    run: 'gnome-terminal --working-directory={cwd} -- {argv}',
};
const TILIX = {
    open: 'tilix --working-directory={cwd}',
    run: 'tilix --working-directory={cwd} -e {cmdline}',
};

test('template: wrapInTerminal with empty argv uses the open template', () => {
    assert.deepEqual(wrapInTerminal(GNOME, '/home/me/my project', []), [
        'gnome-terminal',
        '--working-directory=/home/me/my project',
    ]);
});

test('template: wrapInTerminal splices {argv} as separate arguments', () => {
    assert.deepEqual(wrapInTerminal(GNOME, '/p', ['ssh', '-t', 'h', 'cd ~; exec "$SHELL" -l']), [
        'gnome-terminal',
        '--working-directory=/p',
        '--',
        'ssh',
        '-t',
        'h',
        'cd ~; exec "$SHELL" -l',
    ]);
});

test('template: wrapInTerminal fills {cmdline} inside one argument', () => {
    assert.deepEqual(wrapInTerminal(TILIX, '/p', ['claude', 'a b']), [
        'tilix',
        '--working-directory=/p',
        '-e',
        "'claude' 'a b'",
    ]);
});

test('template: wrapInTerminal rejects unknown placeholders in a preset', () => {
    assert.throws(() => wrapInTerminal({ open: 'x', run: 'x {bogus}' }, '/p', ['a']));
});
