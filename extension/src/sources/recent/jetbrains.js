import GLib from 'gi://GLib';
import { finish, listDirNames, mtimeMs } from './common.js';

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text) {
    return text.replace(/&(amp|lt|gt|quot|apos);/g, (_m, name) => XML_ENTITIES[name]);
}

/**
 * Parse recentProjects.xml. Entries sit under the RecentProjectsManager component and are keyed
 * by path; `projectOpenTimestamp` is read from an attribute or from an `<option>` when present.
 * @param {string} xml
 * @param {string} home replaces $USER_HOME$
 * @param {number} [fallbackTime] used for entries without a timestamp
 * @returns {{path: string, time: number}[]}
 */
export function parseRecentProjects(xml, home, fallbackTime = 0) {
    const component = /<component\s+name="RecentProjectsManager"[^>]*>([\s\S]*?)<\/component>/.exec(
        xml,
    );
    if (!component) return [];
    const out = [];
    const entryRe = /<entry\s+key="([^"]*)"\s*(?:\/>|>([\s\S]*?)<\/entry>)/g;
    for (let m = entryRe.exec(component[1]); m !== null; m = entryRe.exec(component[1])) {
        const path = decode(m[1]).replace('$USER_HOME$', home);
        if (!path.startsWith('/')) continue;
        const body = m[2] ?? '';
        const ts =
            /projectOpenTimestamp="(\d+)"/.exec(body) ??
            /name="projectOpenTimestamp"\s+value="(\d+)"/.exec(body);
        out.push({ path, time: ts ? Number(ts[1]) : fallbackTime });
    }
    return out;
}

export async function read({ home = GLib.get_home_dir() } = {}) {
    const base = `${home}/.config/JetBrains`;
    const entries = [];
    for (const dir of listDirNames(base)) {
        const file = `${base}/${dir}/options/recentProjects.xml`;
        try {
            const [ok, bytes] = GLib.file_get_contents(file);
            if (ok) {
                const xml = new TextDecoder().decode(bytes);
                entries.push(...parseRecentProjects(xml, home, mtimeMs(file)));
            }
        } catch (_e) {
            // This product has no recent list.
        }
    }
    return finish(entries);
}
