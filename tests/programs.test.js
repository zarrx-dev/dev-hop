import { findInDirs, searchDirs } from '../extension/src/core/programs.js';
import { assert, test } from './harness.js';

const home = '/home/alex';
const systemPath = '/usr/local/bin:/usr/bin:/bin';

test('programs: searchDirs lists PATH, then user folders, then Flatpak exports', () => {
    assert.deepEqual(searchDirs({ home, envPath: systemPath }), [
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/home/alex/.local/bin',
        '/home/alex/bin',
        '/home/alex/.cargo/bin',
        '/home/alex/go/bin',
        '/home/alex/.npm-global/bin',
        '/home/alex/.bun/bin',
        '/home/alex/.deno/bin',
        '/home/alex/.local/share/flatpak/exports/bin',
        '/var/lib/flatpak/exports/bin',
    ]);
});

test('programs: searchDirs drops repeats and keeps the first position', () => {
    const dirs = searchDirs({
        home,
        envPath: `/home/alex/.cargo/bin:/usr/bin:/usr/bin:/home/alex/.local/bin`,
    });
    assert.deepEqual(dirs.slice(0, 3), [
        '/home/alex/.cargo/bin',
        '/usr/bin',
        '/home/alex/.local/bin',
    ]);
    assert.equal(dirs.filter((d) => d === '/home/alex/.cargo/bin').length, 1);
    assert.equal(new Set(dirs).size, dirs.length);
});

test('programs: searchDirs expands ~ and ignores empty entries', () => {
    const dirs = searchDirs({ home, envPath: '~/tools::~' });
    assert.deepEqual(dirs.slice(0, 2), ['/home/alex/tools', '/home/alex']);
    assert.ok(dirs.every((d) => !d.includes('~')));
    assert.ok(searchDirs({ home, envPath: null }).includes('/home/alex/.local/bin'));
});

test('programs: findInDirs returns the first folder holding the program', () => {
    const present = new Set([
        '/usr/bin/zed',
        '/home/alex/.local/bin/zed',
        '/home/alex/.local/bin/claude',
    ]);
    const isExec = (p) => present.has(p);
    const dirs = searchDirs({ home, envPath: '/usr/bin' });
    assert.equal(findInDirs('zed', dirs, isExec), '/usr/bin/zed');
    assert.equal(findInDirs('claude', dirs, isExec), '/home/alex/.local/bin/claude');
    assert.equal(findInDirs('missing', dirs, isExec), null);
});

test('programs: findInDirs checks an absolute name directly', () => {
    const isExec = (p) => p === '/opt/tool/run';
    assert.equal(findInDirs('/opt/tool/run', [], isExec), '/opt/tool/run');
    assert.equal(findInDirs('/opt/tool/other', ['/opt/tool'], isExec), null);
    assert.equal(findInDirs('', ['/opt/tool'], isExec), null);
});
