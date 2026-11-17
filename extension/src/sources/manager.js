import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { getJSON, logWarn } from '../settings.js';
import { scanGit } from './gitScan.js';
import { baseName, realPath } from './paths.js';
import { loadPinned } from './pinned.js';
import { read as readClaude } from './recent/claudeCode.js';
import { read as readJetBrains } from './recent/jetbrains.js';
import { readCursor, readVscode, readVscodium } from './recent/vscodeFamily.js';
import { read as readZed } from './recent/zed.js';
import { loadServers } from './servers.js';

export const REFRESH_INTERVAL_MS = 60 * 1000;

/** Keys whose change needs the folders and recent lists read again. */
const HEAVY_KEYS = [
    'search-roots',
    'scan-depth',
    'skip-dirs',
    'include-worktrees',
    'recent-sources',
];
/** Keys that only change how the data already read is combined. */
const LIGHT_KEYS = ['pinned', 'max-recent', 'item-overrides', 'server-meta', 'ssh-config-path'];

export const RECENT_READERS = [
    { id: 'vscode', label: 'VS Code', read: readVscode },
    { id: 'vscodium', label: 'VSCodium', read: readVscodium },
    { id: 'cursor', label: 'Cursor', read: readCursor },
    { id: 'zed', label: 'Zed', read: readZed },
    { id: 'jetbrains', label: 'JetBrains', read: readJetBrains },
    { id: 'claude', label: 'Claude Code', read: readClaude },
];

/**
 * Combine the groups: pinned first, then recent (newest first, capped), then git by name. A
 * folder appears once, in the first group that has it. Hidden items are removed but still hold
 * their place, so they do not come back through another group.
 * @param {{pinned: object[], recent: {label: string, entries: {path: string, time: number}[]}[],
 *   git: object[], overrides: object, maxRecent: number,
 *   canonicalize?: (path: string) => string}} input
 */
export function mergeProjects({
    pinned,
    recent,
    git,
    overrides,
    maxRecent,
    canonicalize = (p) => p,
}) {
    const seen = new Set();
    const out = [];
    const take = (item, limit = Number.POSITIVE_INFINITY, counter = { n: 0 }) => {
        if (counter.n >= limit) return;
        const key = canonicalize(item.path);
        if (seen.has(key)) return;
        seen.add(key);
        const o = overrides?.[item.path];
        if (o?.hidden) return;
        const result = { ...item };
        if (o?.defaultAction) result.defaultAction = o.defaultAction;
        out.push(result);
        counter.n++;
    };

    for (const item of pinned) take(item);

    const recentItems = recent
        .flatMap((group) =>
            group.entries.map((e) => ({
                kind: 'project',
                path: e.path,
                name: baseName(e.path),
                source: 'recent',
                recentFrom: group.label,
                time: e.time,
            })),
        )
        .sort((a, b) => b.time - a.time);
    const counter = { n: 0 };
    for (const item of recentItems) take(item, maxRecent, counter);

    const gitItems = [...git].sort(
        (a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path),
    );
    for (const item of gitItems) take(item);
    return out;
}

const DEFAULT_DEPS = {
    readers: RECENT_READERS,
    loadPinned,
    scanGit,
    loadServers,
    canonicalize: realPath,
    now: () => GLib.get_monotonic_time() / 1000,
};

export class SourceManager {
    /**
     * @param {object} settings
     * @param {Partial<typeof DEFAULT_DEPS>} [deps] replacements for the data sources, for tests
     */
    constructor(settings, deps = {}) {
        this._settings = settings;
        this._deps = { ...DEFAULT_DEPS, ...deps };
        this._projects = [];
        this._servers = [];
        this._raw = null;
        this._last = null;
        this._running = null;
        this._cancellable = null;
        this._listeners = new Map();
        this._nextId = 1;
        this._destroyed = false;
        this._handlerIds = [];

        for (const key of HEAVY_KEYS) {
            this._handlerIds.push(
                this._settings.connect(`changed::${key}`, () => this.refresh({ force: true })),
            );
        }
        for (const key of LIGHT_KEYS) {
            this._handlerIds.push(
                this._settings.connect(`changed::${key}`, () => {
                    if (this._raw) this._rebuild();
                    else this.refresh({ force: true });
                }),
            );
        }
    }

    /** Callback emitter. Only the 'changed' event is fired. */
    connect(name, callback) {
        const id = this._nextId++;
        this._listeners.set(id, { name, callback });
        return id;
    }

    disconnect(id) {
        this._listeners.delete(id);
    }

    _emit(name) {
        for (const l of [...this._listeners.values()]) {
            if (l.name !== name) continue;
            try {
                l.callback();
            } catch (e) {
                logWarn(`dev-hop: listener for "${name}" failed: ${e.message}`);
            }
        }
    }

    getProjects() {
        return [...this._projects];
    }

    getServers() {
        return [...this._servers];
    }

    /**
     * Read all sources in parallel and rebuild the lists. Does nothing when the last refresh was
     * under a minute ago, unless `force` is set. A forced refresh cancels the one in progress.
     * @param {{force?: boolean}} [options]
     * @returns {Promise<void>}
     */
    refresh({ force = false } = {}) {
        if (this._destroyed) return Promise.resolve();
        if (!force) {
            if (this._running) return this._running;
            if (this._last !== null && this._deps.now() - this._last < REFRESH_INTERVAL_MS) {
                return Promise.resolve();
            }
        }
        this._cancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        const run = this._run(cancellable).finally(() => {
            if (this._running === run) this._running = null;
        });
        this._running = run;
        return run;
    }

    async _run(cancellable) {
        const settings = this._settings;
        const enabled = getJSON(settings, 'recent-sources', '{}') ?? {};
        const safe = async (fn) => {
            try {
                return await fn();
            } catch (e) {
                logWarn(`dev-hop: a source failed: ${e.message}`);
                return [];
            }
        };
        const [git, recent] = await Promise.all([
            safe(() => this._deps.scanGit(settings, cancellable)),
            Promise.all(
                this._deps.readers
                    .filter((r) => enabled[r.id] === true)
                    .map(async (r) => ({
                        label: r.label,
                        entries: await safe(() => r.read({ cancellable })),
                    })),
            ),
        ]);
        if (cancellable.is_cancelled() || this._destroyed) return;
        this._raw = { git, recent };
        this._last = this._deps.now();
        this._rebuild();
    }

    _rebuild() {
        if (this._destroyed || !this._raw) return;
        const settings = this._settings;
        let pinned = [];
        let servers = [];
        try {
            pinned = this._deps.loadPinned(settings);
        } catch (e) {
            logWarn(`dev-hop: pinned folders failed: ${e.message}`);
        }
        try {
            servers = this._deps.loadServers(settings);
        } catch (e) {
            logWarn(`dev-hop: ssh config failed: ${e.message}`);
        }
        const cache = new Map();
        const canonicalize = (p) => {
            if (!cache.has(p)) cache.set(p, this._deps.canonicalize(p));
            return cache.get(p);
        };
        this._projects = mergeProjects({
            pinned,
            recent: this._raw.recent,
            git: this._raw.git,
            overrides: getJSON(settings, 'item-overrides', '{}') ?? {},
            maxRecent: settings.get_int('max-recent'),
            canonicalize,
        });
        this._servers = servers;
        this._emit('changed');
    }

    destroy() {
        this._destroyed = true;
        this._cancellable?.cancel();
        this._cancellable = null;
        for (const id of this._handlerIds) this._settings.disconnect(id);
        this._handlerIds = [];
        this._listeners.clear();
    }
}
