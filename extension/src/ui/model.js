// Pure helpers for the top bar menu and the search popup: grouping, subtitles and highlight
// markup. No shell imports, so tests can run it under plain gjs.
import { rank, score } from '../core/fuzzy.js';

export const DEFAULT_LIMIT = 50;
export const HIGHLIGHT_COLOR = '#78aeed';

/** Fields searched, with `name` and `host` (the two display names) weighing most. */
const SEARCH_FIELDS = [
    { key: 'name', weight: 2 },
    { key: 'host', weight: 2 },
    { key: 'path', weight: 1 },
    { key: 'hostName', weight: 1 },
    { key: 'user', weight: 1 },
    { key: 'aliases', weight: 1 },
    { key: 'remoteDir', weight: 1 },
];

/** Texts for the empty states, shared by the menu and the popup. */
export const EMPTY_COPY = {
    noProjects: {
        title: 'No projects yet',
        text: 'dev-hop looks for git repositories in your home folder. Pin a folder to get started.',
    },
    noPinnedOrRecent: {
        title: 'No pinned or recent projects',
        text: 'Search to find your git projects, or pin a folder.',
    },
    noServers: {
        title: 'No SSH hosts found',
        text: 'Hosts from ~/.ssh/config show up here. Add one in Settings.',
    },
    noMatches: (query) => ({
        title: `No matches for "${query}"`,
        text: 'Try part of a name or path. New folders appear after the next scan of your search roots.',
    }),
};

/** Replace a leading home folder with ~. */
export function shortenHome(path, home) {
    if (!home) return path;
    const h = home.length > 1 && home.endsWith('/') ? home.slice(0, -1) : home;
    if (path === h) return '~';
    if (path.startsWith(`${h}/`)) return `~${path.slice(h.length)}`;
    return path;
}

/** Escape text for Pango markup. */
export function escapeMarkup(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Pango markup for `text` with the characters at `indices` coloured and bold. Everything is
 * escaped. Without indices the result is just the escaped text.
 * @param {string} text
 * @param {number[]} indices positions in `text` (from fuzzy.score)
 * @param {string} [color]
 */
export function highlightMarkup(text, indices, color = HIGHLIGHT_COLOR) {
    if (!indices || indices.length === 0) return escapeMarkup(text);
    const matched = new Set(indices);
    let out = '';
    let run = '';
    let inMatch = false;
    const flush = () => {
        if (run === '') return;
        const escaped = escapeMarkup(run);
        out += inMatch ? `<span foreground="${color}" weight="bold">${escaped}</span>` : escaped;
        run = '';
    };
    for (let i = 0; i < text.length; i++) {
        const m = matched.has(i);
        if (m !== inMatch) {
            flush();
            inMatch = m;
        }
        run += text[i];
    }
    flush();
    return out;
}

/** The short name of an action for the small tag: "Open in Zed" becomes "Zed". */
export function shortActionName(name) {
    const here = /^open\s+(.+?)\s+here$/i.exec(name);
    if (here) return here[1].charAt(0).toUpperCase() + here[1].slice(1);
    const inApp = /^open in\s+(.+)$/i.exec(name);
    if (inApp) return inApp[1];
    return name;
}

/** The icon kind for a row: pin, clock, branch or server. */
export function rowIcon(kind, item) {
    if (kind === 'server') return 'server';
    if (item.source === 'pinned') return 'pin';
    if (item.source === 'recent') return 'clock';
    return 'branch';
}

/**
 * A short "how long ago" text for a wall-clock time in ms. Empty for a missing, zero, NaN or
 * future time.
 */
export function timeAgo(ms, nowMs = Date.now()) {
    if (!Number.isFinite(ms) || ms <= 0 || !Number.isFinite(nowMs) || ms > nowMs) return '';
    const MIN = 60000;
    const diff = nowMs - ms;
    if (diff < MIN) return 'just now';
    if (diff < 60 * MIN) return `${Math.floor(diff / MIN)}m ago`;
    const hours = diff / (60 * MIN);
    if (hours < 24) return `${Math.floor(hours)}h ago`;
    if (hours < 48) return 'yesterday';
    const days = hours / 24;
    if (days < 14) return `${Math.floor(days)}d ago`;
    if (days < 60) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
}

/**
 * The dim line under a project name: the path with ~, and for a recent project how long ago it
 * was used ("- 2h ago", or "- 2h ago in Claude Code" when `verbose`). Without a usable time it
 * falls back to the source ("- Cursor", or "- recent in Cursor" when `verbose`).
 */
export function projectSubtitle(project, home, { verbose = false, now = Date.now() } = {}) {
    const path = shortenHome(project.path, home);
    if (project.source === 'recent' && project.recentFrom) {
        const ago = timeAgo(project.time, now);
        if (ago) {
            return `${path}  -  ${ago}${verbose ? ` in ${project.recentFrom}` : ''}`;
        }
        return `${path}  -  ${verbose ? 'recent in ' : ''}${project.recentFrom}`;
    }
    return path;
}

/** The dim line under a server name: user@hostName, optionally followed by the remote folder. */
export function serverSubtitle(server, { withRemoteDir = false } = {}) {
    const target = server.hostName || server.host;
    const base = server.user ? `${server.user}@${target}` : target;
    return withRemoteDir && server.remoteDir ? `${base}  -  ${server.remoteDir}` : base;
}

function matchIndices(query, text) {
    return score(query, text)?.indices ?? [];
}

function projectRow(item, home, verbose, indices = [], now = Date.now()) {
    return {
        kind: 'project',
        item,
        name: item.name,
        nameMarkup: highlightMarkup(item.name, indices),
        icon: rowIcon('project', item),
        subtitle: projectSubtitle(item, home, { verbose, now }),
        indices,
    };
}

function serverRow(item, withRemoteDir, indices = []) {
    return {
        kind: 'server',
        item,
        name: item.host,
        nameMarkup: highlightMarkup(item.host, indices),
        icon: 'server',
        subtitle: serverSubtitle(item, { withRemoteDir }),
        indices,
    };
}

/**
 * Group what to show.
 *
 * Without a query: Pinned, Recent and Servers. Git-only projects are left out. With a query:
 * everything is ranked together (git projects included), cut to `limit`, then split into
 * Projects and Servers, each keeping the rank order.
 *
 * @param {{projects: object[], servers: object[], query?: string, mode?: 'menu'|'popup',
 *   home?: string, limit?: number}} input `mode` only changes wording: the section named
 *   "Recent projects" in the menu is "Recent" in the popup, and the popup subtitles are longer.
 * @returns {{query: string, total: number,
 *   sections: {id: string, label: string, count: number, rows: object[]}[]}}
 */
export function buildSections({
    projects,
    servers,
    query = '',
    mode = 'menu',
    home = '',
    limit = DEFAULT_LIMIT,
    now = Date.now(),
}) {
    const q = query.trim();
    const verbose = mode === 'popup';
    const sections = [];
    const add = (id, label, rows) => {
        if (rows.length > 0) sections.push({ id, label, count: rows.length, rows });
    };

    if (q !== '') {
        const ranked = rank(q, [...projects, ...servers], SEARCH_FIELDS).slice(0, limit);
        const projectRows = [];
        const serverRows = [];
        for (const item of ranked) {
            if (item.kind === 'server') {
                serverRows.push(serverRow(item, verbose, matchIndices(q, item.host)));
            } else {
                projectRows.push(projectRow(item, home, verbose, matchIndices(q, item.name), now));
            }
        }
        add('projects', 'Projects', projectRows);
        add('servers', 'Servers', serverRows);
    } else {
        let budget = limit;
        const take = (list, make) => {
            const rows = list.slice(0, Math.max(budget, 0)).map(make);
            budget -= rows.length;
            return rows;
        };
        const make = (item) => projectRow(item, home, verbose, [], now);
        add(
            'pinned',
            'Pinned',
            take(
                projects.filter((p) => p.source === 'pinned'),
                make,
            ),
        );
        add(
            'recent',
            mode === 'menu' ? 'Recent projects' : 'Recent',
            take(
                projects.filter((p) => p.source === 'recent'),
                make,
            ),
        );
        add(
            'servers',
            'Servers',
            take(servers, (s) => serverRow(s, false)),
        );
    }
    const total = sections.reduce((n, s) => n + s.rows.length, 0);
    return { query: q, total, sections };
}

/** All rows of the sections in display order. */
export function flattenRows(sections) {
    return sections.flatMap((s) => s.rows);
}

/**
 * The key hints for the popup footer.
 * @param {{state: 'results'|'chooser'|'empty', actionName?: string}} input
 * @returns {{key: string, text: string}[]}
 */
export function footerHints({ state, actionName = '' }) {
    if (state === 'chooser') {
        return [
            { key: 'Enter', text: 'Run action' },
            { key: 'Esc', text: 'Back to results' },
        ];
    }
    if (state === 'empty') {
        return [
            { key: 'Esc', text: 'close' },
            { key: 'Ctrl+Backspace', text: 'clear' },
        ];
    }
    return [
        { key: 'Enter', text: actionName || 'Run' },
        { key: 'Shift+Enter', text: 'more actions' },
        { key: 'Esc', text: 'close' },
    ];
}
