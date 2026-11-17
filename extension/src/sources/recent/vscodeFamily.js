// VS Code, VSCodium and Cursor keep their recent list in a SQLite key-value table.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { finish, mtimeMs } from './common.js';
import { queryJson } from './sqlite.js';

const SQL = "select value from ItemTable where key = 'recently.opened'";

export const APPS = {
    vscode: { label: 'VS Code', configDir: 'Code' },
    vscodium: { label: 'VSCodium', configDir: 'VSCodium' },
    cursor: { label: 'Cursor', configDir: 'Cursor' },
};

/**
 * Parse the JSON value of the `recently.opened` row. Only local folders are kept. The list is
 * newest first and has no timestamps, so the time is `baseTime` minus one second per position.
 * @param {string} json
 * @param {number} [baseTime] ms
 * @returns {{path: string, time: number}[]}
 */
export function parseRecentlyOpened(json, baseTime = 0) {
    let data;
    try {
        data = JSON.parse(json);
    } catch (_e) {
        return [];
    }
    const out = [];
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    entries.forEach((entry, index) => {
        const uri = entry?.folderUri;
        if (typeof uri !== 'string' || !uri.startsWith('file://')) return;
        const path = Gio.File.new_for_uri(uri).get_path();
        if (path) out.push({ path, time: baseTime - index * 1000 });
    });
    return out;
}

/**
 * @param {string} appId vscode, vscodium or cursor
 * @param {{home?: string, cancellable?: Gio.Cancellable|null}} [options]
 */
export async function readApp(appId, { home = GLib.get_home_dir(), cancellable = null } = {}) {
    const app = APPS[appId];
    const db = `${home}/.config/${app.configDir}/User/globalStorage/state.vscdb`;
    const rows = await queryJson(db, SQL, cancellable);
    const value = rows[0]?.value;
    if (typeof value !== 'string') return [];
    return finish(parseRecentlyOpened(value, mtimeMs(db)));
}

export const readVscode = (options) => readApp('vscode', options);
export const readVscodium = (options) => readApp('vscodium', options);
export const readCursor = (options) => readApp('cursor', options);
