import GLib from 'gi://GLib';
import { finish, listDirNames } from './common.js';
import { queryJson } from './sqlite.js';

const SQL =
    'select paths, timestamp from workspaces where remote_connection_id is null order by timestamp desc';

function toMs(timestamp) {
    if (typeof timestamp === 'number') return timestamp;
    // SQLite CURRENT_TIMESTAMP text, UTC: "2024-05-01 10:00:00".
    const ms = Date.parse(`${String(timestamp).replace(' ', 'T')}Z`);
    return Number.isNaN(ms) ? 0 : ms;
}

/**
 * @param {{paths: string, timestamp: string|number}[]} rows
 * @returns {{path: string, time: number}[]} one entry per path; a workspace can hold several
 */
export function parseWorkspaces(rows) {
    const out = [];
    for (const row of rows) {
        if (typeof row?.paths !== 'string') continue;
        const time = toMs(row.timestamp);
        for (const path of row.paths.split('\n')) {
            if (path.startsWith('/')) out.push({ path, time });
        }
    }
    return out;
}

export async function read({ home = GLib.get_home_dir(), cancellable = null } = {}) {
    const base = `${home}/.local/share/zed/db`;
    const dirs = listDirNames(base).filter((d) => d !== '0-global');
    const results = await Promise.all(
        dirs.map((d) => queryJson(`${base}/${d}/db.sqlite`, SQL, cancellable)),
    );
    return finish(results.flatMap(parseWorkspaces));
}
