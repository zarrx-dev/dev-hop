import GLib from 'gi://GLib';
import { listHosts, loadWithIncludes } from '../core/sshConfig.js';
import { expandHome, getJSON } from '../settings.js';

/**
 * SSH hosts from the config file and its includes, merged with the per-server settings.
 * A missing config file gives [].
 * @param {object} settings
 * @param {{readFile?: (path: string) => string|null, home?: string,
 *   listDir?: (dir: string) => string[]}} [options] replacements for the disk, for tests
 */
export function loadServers(settings, { readFile, home = GLib.get_home_dir(), listDir } = {}) {
    const path = expandHome(settings.get_string('ssh-config-path'), home);
    const { model, hosts } = loadWithIncludes(path, readFile, { home, listDir });
    const entries = [...listHosts(model), ...hosts.filter((h) => h.source !== null)];
    const meta = getJSON(settings, 'server-meta', '{}') ?? {};
    return entries.map((e) => {
        const host = e.aliases[0];
        const m = Object.hasOwn(meta, host) ? meta[host] : null;
        return {
            kind: 'server',
            host,
            aliases: e.aliases,
            user: e.fields.User,
            hostName: e.fields.HostName,
            port: e.fields.Port,
            editable: e.editable,
            source: e.source,
            blockIndex: e.index,
            remoteDir: m?.remoteDir || '',
            defaultAction: m?.defaultAction || '',
        };
    });
}
