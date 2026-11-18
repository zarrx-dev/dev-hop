import { score } from '../extension/src/core/fuzzy.js';
import {
    buildSections,
    escapeMarkup,
    flattenRows,
    footerHints,
    highlightMarkup,
    projectSubtitle,
    rowIcon,
    serverSubtitle,
    shortActionName,
    shortenHome,
} from '../extension/src/ui/model.js';
import { assert, test } from './harness.js';

const HOME = '/home/alex';

const projects = [
    { kind: 'project', path: '/home/alex/code/acme-api', name: 'acme-api', source: 'pinned' },
    {
        kind: 'project',
        path: '/home/alex/work/storefront-web',
        name: 'storefront-web',
        source: 'pinned',
    },
    {
        kind: 'project',
        path: '/home/alex/code/blog',
        name: 'blog',
        source: 'recent',
        recentFrom: 'Cursor',
    },
    {
        kind: 'project',
        path: '/home/alex/work/storefront-admin',
        name: 'storefront-admin',
        source: 'git',
    },
];

const servers = [
    { kind: 'server', host: 'staging', user: 'deploy', hostName: 'staging.example.com' },
    {
        kind: 'server',
        host: 'prod-web',
        user: 'deploy',
        hostName: '203.0.113.10',
        remoteDir: '/srv/storefront-web',
    },
];

test('uiModel: shortenHome replaces only a leading home folder', () => {
    assert.equal(shortenHome('/home/alex/code/app', HOME), '~/code/app');
    assert.equal(shortenHome('/home/alex', HOME), '~');
    assert.equal(shortenHome('/home/alexander/code', HOME), '/home/alexander/code');
    assert.equal(shortenHome('/srv/home/alex/x', HOME), '/srv/home/alex/x');
    assert.equal(shortenHome('/home/alex/code', '/home/alex/'), '~/code');
    assert.equal(shortenHome('/opt/app', ''), '/opt/app');
});

test('uiModel: escapeMarkup escapes the Pango special characters', () => {
    assert.equal(
        escapeMarkup('a & b <c> "d" \'e\''),
        'a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;',
    );
});

test('uiModel: highlightMarkup wraps matched runs and escapes everything', () => {
    assert.equal(highlightMarkup('a&b', []), 'a&amp;b');
    const out = highlightMarkup('store<web', [0, 1, 5], '#fff');
    assert.equal(
        out,
        '<span foreground="#fff" weight="bold">st</span>or' +
            'e<span foreground="#fff" weight="bold">&lt;</span>web',
    );
    const q = score('sw', 'storefront-web');
    assert.equal(
        highlightMarkup('storefront-web', q.indices, '#fff'),
        '<span foreground="#fff" weight="bold">s</span>torefront-' +
            '<span foreground="#fff" weight="bold">w</span>eb',
    );
});

test('uiModel: shortActionName strips the "Open" wording', () => {
    assert.equal(shortActionName('Open in Zed'), 'Zed');
    assert.equal(shortActionName('Open terminal here'), 'Terminal');
    assert.equal(shortActionName('Terminal + Claude Code'), 'Terminal + Claude Code');
    assert.equal(shortActionName('SSH'), 'SSH');
});

test('uiModel: subtitles and icons', () => {
    assert.equal(projectSubtitle(projects[0], HOME), '~/code/acme-api');
    assert.equal(projectSubtitle(projects[2], HOME), '~/code/blog  -  Cursor');
    assert.equal(
        projectSubtitle(projects[2], HOME, { verbose: true }),
        '~/code/blog  -  recent in Cursor',
    );
    assert.equal(serverSubtitle(servers[0]), 'deploy@staging.example.com');
    assert.equal(serverSubtitle({ host: 'box' }), 'box');
    assert.equal(
        serverSubtitle(servers[1], { withRemoteDir: true }),
        'deploy@203.0.113.10  -  /srv/storefront-web',
    );
    assert.equal(rowIcon('project', projects[0]), 'pin');
    assert.equal(rowIcon('project', projects[2]), 'clock');
    assert.equal(rowIcon('project', projects[3]), 'branch');
    assert.equal(rowIcon('server', servers[0]), 'server');
});

test('uiModel: without a query the groups are Pinned, Recent and Servers, without git', () => {
    const m = buildSections({ projects, servers, home: HOME });
    assert.deepEqual(
        m.sections.map((s) => [s.id, s.label, s.count]),
        [
            ['pinned', 'Pinned', 2],
            ['recent', 'Recent projects', 1],
            ['servers', 'Servers', 2],
        ],
    );
    assert.equal(m.total, 5);
    const names = flattenRows(m.sections).map((r) => r.name);
    assert.ok(!names.includes('storefront-admin'), 'git-only repos stay out of the menu');
    assert.equal(m.sections[0].rows[0].subtitle, '~/code/acme-api');
    const popup = buildSections({ projects, servers, home: HOME, mode: 'popup' });
    assert.equal(popup.sections[1].label, 'Recent');
    assert.equal(popup.sections[1].rows[0].subtitle, '~/code/blog  -  recent in Cursor');
});

test('uiModel: empty groups are left out', () => {
    const m = buildSections({ projects: [], servers: [], home: HOME });
    assert.equal(m.total, 0);
    assert.deepEqual(m.sections, []);
    const onlyServers = buildSections({ projects: [], servers, home: HOME });
    assert.deepEqual(
        onlyServers.sections.map((s) => s.id),
        ['servers'],
    );
});

test('uiModel: with a query git projects appear, split into Projects and Servers', () => {
    const m = buildSections({ projects, servers, query: 'store', home: HOME, mode: 'popup' });
    assert.deepEqual(
        m.sections.map((s) => s.id),
        ['projects', 'servers'],
    );
    const names = m.sections[0].rows.map((r) => r.name);
    assert.deepEqual([...names].sort(), ['storefront-admin', 'storefront-web']);
    const web = m.sections[0].rows.find((r) => r.name === 'storefront-web');
    assert.ok(web.nameMarkup.includes('<span'), 'matched letters are marked');
    assert.deepEqual(web.indices, [0, 1, 2, 3, 4]);
    // prod-web matches through its remote folder, so its name has no highlight.
    const prod = m.sections[1].rows.find((r) => r.name === 'prod-web');
    assert.ok(prod, 'a server is found through its other fields');
    assert.equal(prod.subtitle, 'deploy@203.0.113.10  -  /srv/storefront-web');
    assert.equal(m.total, 3);
});

test('uiModel: a query with no match gives no sections', () => {
    const m = buildSections({ projects, servers, query: 'zzq', home: HOME });
    assert.equal(m.total, 0);
    assert.deepEqual(m.sections, []);
});

test('uiModel: names with markup characters are escaped in the highlight', () => {
    const odd = [{ kind: 'project', path: '/home/alex/a&b<c>', name: 'a&b<c>', source: 'pinned' }];
    const m = buildSections({ projects: odd, servers: [], query: 'b', home: HOME });
    const markup = m.sections[0].rows[0].nameMarkup;
    assert.ok(markup.includes('a&amp;'), markup);
    assert.ok(markup.includes('&lt;c&gt;'), markup);
    assert.ok(!markup.includes('<c>'), markup);
    const plain = buildSections({ projects: odd, servers: [], home: HOME });
    assert.equal(plain.sections[0].rows[0].nameMarkup, 'a&amp;b&lt;c&gt;');
});

test('uiModel: results are capped at the limit', () => {
    const many = Array.from({ length: 80 }, (_v, i) => ({
        kind: 'project',
        path: `/home/alex/code/app-${i}`,
        name: `app-${i}`,
        source: 'git',
    }));
    const searched = buildSections({ projects: many, servers: [], query: 'app', home: HOME });
    assert.equal(searched.total, 50);
    const pinned = many.map((p) => ({ ...p, source: 'pinned' }));
    const empty = buildSections({ projects: pinned, servers, home: HOME, limit: 10 });
    assert.equal(empty.total, 10);
    assert.deepEqual(
        empty.sections.map((s) => s.id),
        ['pinned'],
    );
});

test('uiModel: footer hints per state', () => {
    assert.deepEqual(footerHints({ state: 'results', actionName: 'Open in Zed' }), [
        { key: 'Enter', text: 'Open in Zed' },
        { key: 'Shift+Enter', text: 'more actions' },
        { key: 'Esc', text: 'close' },
    ]);
    assert.equal(footerHints({ state: 'chooser' })[1].text, 'Back to results');
    assert.equal(footerHints({ state: 'empty' })[1].key, 'Ctrl+Backspace');
});
