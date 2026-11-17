// Helpers for the JSON-in-a-string settings keys. No shell imports, so prefs and tests can use it.
import GLib from 'gi://GLib';

/** Expand a leading ~ to the home folder. */
export function expandHome(path, home = GLib.get_home_dir()) {
    if (path === '~') return home;
    if (path.startsWith('~/')) return `${home}${path.slice(1)}`;
    return path;
}

let logger = null;

/**
 * Replace where warnings go (tests record them). Call with no argument to restore console.warn.
 * console.warn itself cannot be reassigned in gjs.
 * @param {((message: string) => void)|null} [fn]
 */
export function setLogger(fn = null) {
    logger = fn;
}

/** Log a warning through the injectable logger. */
export function logWarn(message) {
    if (logger) logger(message);
    else console.warn(message);
}

function schemaDefault(settings, key) {
    try {
        return settings.settings_schema.get_key(key).get_default_value().deepUnpack();
    } catch (_e) {
        return null;
    }
}

/**
 * Parse a JSON string key. On bad JSON, logs one warning and parses the schema default instead.
 * `fallbackText` is used only when the settings object has no schema (fakes in tests).
 * @param {{get_string: (key: string) => string}} settings
 * @param {string} key
 * @param {string} [fallbackText]
 * @returns {any}
 */
export function getJSON(settings, key, fallbackText = 'null') {
    try {
        return JSON.parse(settings.get_string(key));
    } catch (e) {
        logWarn(`dev-hop: invalid JSON in setting "${key}" (${e.message}), using the default`);
        return JSON.parse(schemaDefault(settings, key) ?? fallbackText);
    }
}

/**
 * @param {{set_string: (key: string, value: string) => boolean}} settings
 * @param {string} key
 * @param {any} value
 */
export function setJSON(settings, key, value) {
    return settings.set_string(key, JSON.stringify(value));
}
