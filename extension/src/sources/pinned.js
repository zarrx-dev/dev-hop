import { expandHome, getJSON } from '../settings.js';
import { baseName, isDir } from './paths.js';

/**
 * Pinned folders in their settings order. Paths that no longer exist are dropped.
 * @param {object} settings
 * @param {{exists?: (path: string) => boolean}} [options]
 * @returns {{kind: 'project', path: string, name: string, source: 'pinned'}[]}
 */
export function loadPinned(settings, { exists = isDir } = {}) {
    const raw = getJSON(settings, 'pinned', '[]');
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const entry of raw) {
        if (typeof entry?.path !== 'string' || entry.path === '') continue;
        const path = expandHome(entry.path);
        if (!exists(path)) continue;
        out.push({ kind: 'project', path, name: baseName(path), source: 'pinned' });
    }
    return out;
}
