import {
    addHost,
    deleteHost,
    listHosts,
    loadWithIncludes,
    parse,
    serialize,
    updateHost,
} from '../extension/src/core/sshConfig.js';
import { assert, test } from './harness.js';

const MESSY = [
    '# top comment',
    'Include ~/.ssh/extra.conf',
    'ServerAliveInterval 30',
    '',
    'Host prod web',
    '    HostName 10.0.0.5',
    '\tUser deploy',
    '    # keep me',
    '    ForwardAgent yes',
    '',
    '',
    'host=staging',
    '  hostname=staging.example.com',
    '  IDENTITYFILE "~/.ssh/my key"',
    '  Port=2222',
    '',
    '# header for the match block',
    'Match host *.internal',
    '    User internal',
    '',
    'Host *',
    '    IdentitiesOnly yes',
    '',
    'Host last',
    '    HostName last.example.com',
];

const join = (lines, eol = '\n', final = true) => lines.join(eol) + (final ? eol : '');

function lineTexts(model) {
    return model.lines.map((l) => l.text);
}

test('sshConfig: round trip is byte exact (lf, final newline)', () => {
    const text = join(MESSY);
    assert.equal(serialize(parse(text)), text);
});

test('sshConfig: round trip is byte exact (no final newline)', () => {
    const text = join(MESSY, '\n', false);
    assert.equal(serialize(parse(text)), text);
});

test('sshConfig: round trip is byte exact (crlf)', () => {
    const text = join(MESSY, '\r\n');
    assert.equal(serialize(parse(text)), text);
    const noFinal = join(MESSY, '\r\n', false);
    assert.equal(serialize(parse(noFinal)), noFinal);
});

test('sshConfig: round trip of empty and blank-only files', () => {
    for (const text of ['', '\n', '\n\n', '   \n']) {
        assert.equal(serialize(parse(text)), text);
    }
});

test('sshConfig: listHosts reads aliases, fields and skips wildcard-only blocks', () => {
    const hosts = listHosts(parse(join(MESSY)));
    assert.deepEqual(
        hosts.map((h) => h.aliases),
        [['prod', 'web'], ['staging'], ['last']],
    );
    assert.equal(hosts[0].fields.HostName, '10.0.0.5');
    assert.equal(hosts[0].fields.User, 'deploy');
    assert.equal(hosts[0].fields.Port, '');
    assert.equal(hosts[1].fields.HostName, 'staging.example.com');
    assert.equal(hosts[1].fields.IdentityFile, '~/.ssh/my key');
    assert.equal(hosts[1].fields.Port, '2222');
    assert.ok(hosts.every((h) => h.editable));
    // Block indexes count the skipped "Host *" block.
    assert.deepEqual(
        hosts.map((h) => h.index),
        [0, 1, 3],
    );
});

test('sshConfig: mixed wildcard aliases are listed but not editable', () => {
    const model = parse('Host app *.example.com\n  User x\n\nHost *\n  User y\n');
    const hosts = listHosts(model);
    assert.equal(hosts.length, 1);
    assert.equal(hosts[0].editable, false);
    assert.throws(() => updateHost(model, 0, { User: 'z' }));
    assert.throws(() => deleteHost(model, 0));
});

test('sshConfig: negated alias counts as a pattern', () => {
    const hosts = listHosts(parse('Host !bad\n  User x\n'));
    assert.equal(hosts.length, 0);
});

test('sshConfig: Match blocks and top-level lines are never listed or edited', () => {
    const model = parse(join(MESSY));
    const hosts = listHosts(model);
    assert.ok(!hosts.some((h) => h.aliases.includes('host')));
    assert.throws(() => updateHost(model, 99, { User: 'x' }));
});

test('sshConfig: editing one block leaves every other line identical', () => {
    const before = parse(join(MESSY));
    const after = parse(join(MESSY));
    updateHost(after, 1, { HostName: 'new.example.com', User: 'bob', ProxyJump: 'bastion' });

    const start = before.lines.findIndex((l) => l.text === 'host=staging');
    const end = before.lines.findIndex((l) => l.text === '# header for the match block');
    const b = lineTexts(before);
    const a = lineTexts(after);
    assert.deepEqual(a.slice(0, start), b.slice(0, start));
    const tail = b.length - end;
    assert.deepEqual(a.slice(a.length - tail), b.slice(end));
    assert.ok(a.slice(start, a.length - tail).some((t) => t.includes('new.example.com')));
});

test('sshConfig: update in place keeps indentation, keyword spelling and separator', () => {
    const model = parse(join(MESSY));
    updateHost(model, 0, { User: 'root' });
    updateHost(model, 1, { HostName: 'x.example.com', Port: 22 });
    const t = lineTexts(model);
    assert.ok(t.includes('\tUser root'));
    assert.ok(t.includes('  hostname=x.example.com'));
    assert.ok(t.includes('  Port=22'));
});

test('sshConfig: unchanged values leave the original line verbatim', () => {
    const model = parse(join(MESSY));
    updateHost(model, 1, { IdentityFile: '~/.ssh/my key', Port: '2222' });
    assert.equal(serialize(model), join(MESSY));
});

test('sshConfig: quotes values with spaces', () => {
    const model = parse(join(MESSY));
    updateHost(model, 0, { IdentityFile: '/home/me/my keys/id' });
    assert.ok(lineTexts(model).includes('    IdentityFile "/home/me/my keys/id"'));
    assert.equal(listHosts(model)[0].fields.IdentityFile, '/home/me/my keys/id');
});

test('sshConfig: adds a missing field at the end of the block before blank lines', () => {
    const model = parse(join(MESSY));
    updateHost(model, 0, { Port: '2200' });
    const t = lineTexts(model);
    const i = t.indexOf('    Port 2200');
    assert.equal(t[i - 1], '    ForwardAgent yes');
    assert.equal(t[i + 1], '');
    assert.equal(t[i + 2], '');
    assert.equal(t[i + 3], 'host=staging');
});

test('sshConfig: added field uses the block indentation (tab) and a 4-space default', () => {
    const tabs = parse('Host a\n\tHostName a.com\n');
    updateHost(tabs, 0, { User: 'u' });
    assert.equal(serialize(tabs), 'Host a\n\tHostName a.com\n\tUser u\n');
    const bare = parse('Host a\n');
    updateHost(bare, 0, { User: 'u' });
    assert.equal(serialize(bare), 'Host a\n    User u\n');
});

test('sshConfig: adding to the last block of a file without final newline', () => {
    const model = parse('Host a\n  HostName a.com');
    updateHost(model, 0, { User: 'u' });
    assert.equal(serialize(model), 'Host a\n  HostName a.com\n  User u');
});

test('sshConfig: added field goes before a comment header of the next block', () => {
    const model = parse('Host a\n  HostName a.com\n\n# next\nHost b\n  User b\n');
    updateHost(model, 0, { User: 'u' });
    assert.equal(
        serialize(model),
        'Host a\n  HostName a.com\n  User u\n\n# next\nHost b\n  User b\n',
    );
});

test('sshConfig: removes a field when the new value is empty, keeps unknown lines', () => {
    const model = parse(join(MESSY));
    updateHost(model, 0, { User: '', ProxyJump: '' });
    const t = lineTexts(model);
    assert.ok(!t.includes('\tUser deploy'));
    assert.ok(t.includes('    # keep me'));
    assert.ok(t.includes('    ForwardAgent yes'));
    assert.ok(t.includes('    HostName 10.0.0.5'));
});

test('sshConfig: renames aliases on the Host line only', () => {
    const model = parse(join(MESSY));
    updateHost(model, 0, { aliases: ['production', 'my web'] });
    const t = lineTexts(model);
    assert.ok(t.includes('Host production "my web"'));
    updateHost(model, 1, { aliases: ['stage'] });
    assert.ok(lineTexts(model).includes('host=stage'));
    assert.equal(listHosts(model)[1].aliases[0], 'stage');
});

test('sshConfig: addHost to a file with a trailing newline', () => {
    const model = parse('Host a\n  HostName a.com\n');
    const idx = addHost(model, 'b', { HostName: 'b.com', User: 'me', Port: 22 });
    assert.equal(idx, 1);
    assert.equal(
        serialize(model),
        'Host a\n  HostName a.com\n\nHost b\n    HostName b.com\n    User me\n    Port 22\n',
    );
});

test('sshConfig: addHost to a file without a trailing newline', () => {
    const model = parse('Host a\n  HostName a.com');
    addHost(model, 'b', { HostName: 'b.com' });
    assert.equal(serialize(model), 'Host a\n  HostName a.com\n\nHost b\n    HostName b.com\n');
});

test('sshConfig: addHost adds no extra blank line when the file ends in one, or is empty', () => {
    const blank = parse('Host a\n\n');
    addHost(blank, 'b');
    assert.equal(serialize(blank), 'Host a\n\nHost b\n');
    const empty = parse('');
    addHost(empty, 'b');
    assert.equal(serialize(empty), 'Host b\n');
});

test('sshConfig: addHost uses the file line ending', () => {
    const model = parse('Host a\r\n  HostName a.com\r\n');
    addHost(model, 'b', { User: 'u' });
    assert.equal(serialize(model), 'Host a\r\n  HostName a.com\r\n\r\nHost b\r\n    User u\r\n');
});

const THREE = 'Host a\n  User a\n\nHost b\n  User b\n\nHost c\n  User c\n';

test('sshConfig: deleteHost first, middle and last leave no double blank lines', () => {
    const first = parse(THREE);
    deleteHost(first, 0);
    assert.equal(serialize(first), 'Host b\n  User b\n\nHost c\n  User c\n');

    const middle = parse(THREE);
    deleteHost(middle, 1);
    assert.equal(serialize(middle), 'Host a\n  User a\n\nHost c\n  User c\n');

    const last = parse(THREE);
    deleteHost(last, 2);
    assert.equal(serialize(last), 'Host a\n  User a\n\nHost b\n  User b\n');
});

test('sshConfig: deleteHost keeps a missing final newline and unrelated lines', () => {
    const model = parse('# top\n\nHost a\n  User a\n\nHost b\n  User b');
    deleteHost(model, 1);
    assert.equal(serialize(model), '# top\n\nHost a\n  User a');
    const only = parse('Host a\n  User a\n');
    deleteHost(only, 0);
    assert.equal(serialize(only), '');
});

test('sshConfig: deleteHost keeps the comment header of the next block', () => {
    const model = parse('Host a\n  User a\n\n# for b\nHost b\n  User b\n');
    deleteHost(model, 0);
    assert.equal(serialize(model), '# for b\nHost b\n  User b\n');
});

test('sshConfig: deleting a block leaves the other blocks untouched in the messy file', () => {
    const before = parse(join(MESSY));
    const after = parse(join(MESSY));
    deleteHost(after, 1);
    const t = lineTexts(after);
    assert.ok(!t.includes('host=staging'));
    assert.ok(t.includes('Match host *.internal'));
    assert.ok(t.includes('Host *'));
    assert.ok(t.includes('Host last'));
    for (let i = 1; i < t.length; i++) {
        assert.ok(!(t[i] === '' && t[i - 1] === '') || lineTexts(before).join().includes(',,'));
    }
});

test('sshConfig: loadWithIncludes resolves relative, tilde and glob includes', () => {
    const files = {
        '/home/me/.ssh/config': [
            'Include conf.d/*.conf',
            'Include ~/other/hosts',
            'Include missing.conf',
            '',
            'Host main',
            '  HostName main.com',
            '',
        ].join('\n'),
        '/home/me/.ssh/conf.d/a.conf': 'Host from-a\n  HostName a.com\n',
        '/home/me/.ssh/conf.d/b.conf': 'Host from-b other-b\n  User bee\n',
        '/home/me/.ssh/conf.d/readme.txt': 'Host ignored\n',
        '/home/me/other/hosts': 'Host from-other\n  Port 2022\nInclude nested.conf\n',
        '/home/me/.ssh/nested.conf': 'Host nested\n',
    };
    const dirs = { '/home/me/.ssh/conf.d': ['b.conf', 'a.conf', 'readme.txt'] };
    const reads = [];
    const readFile = (p) => {
        reads.push(p);
        return files[p] ?? null;
    };
    const { model, hosts } = loadWithIncludes('~/.ssh/config', readFile, {
        home: '/home/me',
        listDir: (d) => dirs[d] ?? [],
    });
    assert.equal(serialize(model), files['/home/me/.ssh/config']);
    assert.deepEqual(
        hosts.map((h) => h.aliases.join(',')),
        ['main', 'from-a', 'from-b,other-b', 'from-other', 'nested'],
    );
    assert.equal(hosts[0].editable, true);
    assert.equal(hosts[0].source, null);
    assert.equal(hosts[1].editable, false);
    assert.equal(hosts[1].source, '/home/me/.ssh/conf.d/a.conf');
    assert.equal(hosts[1].index, null);
    assert.equal(hosts[4].source, '/home/me/.ssh/nested.conf');
    assert.ok(!reads.includes('/home/me/.ssh/conf.d/readme.txt'));
});

test('sshConfig: loadWithIncludes copes with a missing main file and include loops', () => {
    const empty = loadWithIncludes('/nope/config', () => null, { home: '/h' });
    assert.equal(empty.hosts.length, 0);
    const files = {
        '/h/.ssh/config': 'Include loop.conf\n',
        '/h/.ssh/loop.conf': 'Include loop.conf\nInclude config\nHost x\n',
    };
    const { hosts } = loadWithIncludes('/h/.ssh/config', (p) => files[p] ?? null, { home: '/h' });
    assert.deepEqual(
        hosts.map((h) => h.aliases[0]),
        ['x'],
    );
});
