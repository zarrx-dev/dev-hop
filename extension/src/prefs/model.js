// Pure helpers for the preferences window: validation, form mapping, settings updates and
// shortcut text. No Gtk or Adw imports, so tests can run it under plain gjs.
import { KNOWN_FIELDS } from '../core/sshConfig.js';
import { PLACEHOLDERS, resolve } from '../core/template.js';

const CONTROL_CHARS = {
    test(text) {
        for (const ch of String(text)) {
            const code = ch.codePointAt(0);
            if (code < 0x20 || code === 0x7f) return true;
        }
        return false;
    },
};

// ---------------------------------------------------------------------------------------------
// ssh hosts

/**
 * Check a Host alias. It ends up on a `Host` line and as an argument of `ssh`, so spaces,
 * patterns, quotes, comment marks and a leading dash are refused.
 * @param {string} alias
 * @param {string[]} taken aliases already used in the config and its includes
 * @param {string|null} [own] the alias being edited, which may keep its name
 * @returns {string|null} an error message, or null when the alias is fine
 */
export function validateAlias(alias, taken, own = null) {
    const value = String(alias ?? '').trim();
    if (value === '') return 'Enter a host alias.';
    if (/\s/.test(value) || CONTROL_CHARS.test(value)) return 'The alias cannot contain spaces.';
    if (/[*?!]/.test(value)) return 'The alias cannot contain * ? or ! (those make a pattern).';
    if (/["'#]/.test(value)) return 'The alias cannot contain quotes or #.';
    if (value.startsWith('-')) return 'The alias cannot start with a dash.';
    const lower = value.toLowerCase();
    const ownLower = own === null ? null : own.toLowerCase();
    const clash = taken.some((t) => t.toLowerCase() === lower && t.toLowerCase() !== ownLower);
    if (clash) return 'A host with this alias already exists.';
    return null;
}

/** @returns {string|null} an error message for a Port value; empty is allowed */
export function validatePort(text) {
    const value = String(text ?? '').trim();
    if (value === '') return null;
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
        return 'The port must be a number from 1 to 65535.';
    }
    return null;
}

/** A value is written to one config line, so it may not hold line breaks or quotes. */
function validateValue(label, text) {
    const value = String(text ?? '');
    if (CONTROL_CHARS.test(value)) return `${label} cannot contain line breaks.`;
    if (value.includes('"')) return `${label} cannot contain double quotes.`;
    return null;
}

/**
 * Map the host form to the fields of sshConfig.updateHost and addHost. Values are trimmed; an
 * empty value means "remove the keyword".
 * @param {Record<string, string>} form keys alias, HostName, User, Port, IdentityFile, ProxyJump
 * @returns {{HostName: string, User: string, Port: string, IdentityFile: string,
 *   ProxyJump: string}}
 */
export function formToFields(form) {
    const out = {};
    for (const key of KNOWN_FIELDS) out[key] = String(form[key] ?? '').trim();
    return out;
}

/**
 * Validate the whole host form.
 * @param {Record<string, string>} form
 * @param {{taken: string[], own?: string|null, restAliases?: string[]}} context
 *   `restAliases` are the other aliases of a multi-alias block, kept after the edited one
 * @returns {{ok: true, aliases: string[], fields: object}|{ok: false, field: string,
 *   message: string}}
 */
export function buildHostChange(form, { taken, own = null, restAliases = [] }) {
    const aliasError = validateAlias(form.alias, taken, own);
    if (aliasError) return { ok: false, field: 'alias', message: aliasError };
    const portError = validatePort(form.Port);
    if (portError) return { ok: false, field: 'Port', message: portError };
    for (const key of KNOWN_FIELDS) {
        const error = validateValue(key, form[key]);
        if (error) return { ok: false, field: key, message: error };
    }
    return {
        ok: true,
        aliases: [String(form.alias).trim(), ...restAliases],
        fields: formToFields(form),
    };
}

/**
 * One line under a host: `user@host, port 22 - via jump - /srv/app`.
 * @param {{aliases: string[], fields: Record<string, string>}} entry
 * @param {string} [remoteDir]
 */
export function hostSubtitle(entry, remoteDir = '') {
    const f = entry.fields;
    const host = f.HostName || entry.aliases[0];
    let text = f.User ? `${f.User}@${host}` : host;
    if (f.Port) text += `, port ${f.Port}`;
    if (f.ProxyJump) text += `  -  via ${f.ProxyJump}`;
    if (remoteDir) text += `  -  ${remoteDir}`;
    return text;
}

/**
 * New per-host settings object. `rename` moves the entry to a new alias; empty values are
 * dropped and a host with nothing left has no entry.
 * @param {Record<string, {remoteDir?: string, defaultAction?: string}>} meta
 * @param {string} host current alias
 * @param {{rename?: string, remoteDir?: string, defaultAction?: string}} patch
 */
export function updateServerMeta(meta, host, patch) {
    const out = Object.create(null);
    for (const [key, value] of Object.entries(meta ?? {})) out[key] = value;
    const current = out[host] ?? {};
    delete out[host];
    const next = {
        remoteDir: patch.remoteDir ?? current.remoteDir ?? '',
        defaultAction: patch.defaultAction ?? current.defaultAction ?? '',
    };
    const entry = {};
    if (next.remoteDir) entry.remoteDir = next.remoteDir;
    if (next.defaultAction) entry.defaultAction = next.defaultAction;
    if (Object.keys(entry).length > 0) out[patch.rename ?? host] = entry;
    return out;
}

/** @returns {object} meta without the host */
export function removeServerMeta(meta, host) {
    const out = Object.create(null);
    for (const [key, value] of Object.entries(meta ?? {})) if (key !== host) out[key] = value;
    return out;
}

// ---------------------------------------------------------------------------------------------
// projects

/**
 * New overrides object with a patch applied to one path. An entry with no default action and
 * not hidden is removed.
 * @param {Record<string, {defaultAction?: string, hidden?: boolean}>} overrides
 * @param {string} path
 * @param {{defaultAction?: string, hidden?: boolean}} patch
 */
export function updateOverride(overrides, path, patch) {
    const out = Object.create(null);
    for (const [key, value] of Object.entries(overrides ?? {})) out[key] = value;
    const current = out[path] ?? {};
    delete out[path];
    const defaultAction = patch.defaultAction ?? current.defaultAction ?? '';
    const hidden = patch.hidden ?? current.hidden ?? false;
    const entry = {};
    if (defaultAction) entry.defaultAction = defaultAction;
    if (hidden) entry.hidden = true;
    if (Object.keys(entry).length > 0) out[path] = entry;
    return out;
}

/** @returns {string[]} names from comma or newline separated text, trimmed, without repeats */
export function parseNameList(text) {
    const seen = new Set();
    for (const part of String(text ?? '').split(/[,\n]/)) {
        const name = part.trim();
        if (name !== '') seen.add(name);
    }
    return [...seen];
}

/** @param {string[]} names */
export function formatNameList(names) {
    return names.join(', ');
}

/**
 * Where each recent source finds its program or data. A tool counts as installed when one of its
 * programs is on PATH or its data folder (relative to home) exists.
 */
export const RECENT_SOURCE_INFO = {
    vscode: { binaries: ['code'], dirs: ['.config/Code'], sqlite: true },
    vscodium: { binaries: ['codium'], dirs: ['.config/VSCodium'], sqlite: true },
    cursor: { binaries: ['cursor'], dirs: ['.config/Cursor'], sqlite: true },
    zed: { binaries: ['zed', 'zeditor'], dirs: ['.local/share/zed'], sqlite: true },
    jetbrains: {
        binaries: [
            'idea',
            'webstorm',
            'pycharm',
            'phpstorm',
            'goland',
            'clion',
            'rider',
            'rubymine',
            'datagrip',
            'rustrover',
        ],
        dirs: ['.config/JetBrains'],
        sqlite: false,
    },
    claude: { binaries: ['claude'], dirs: ['.claude/projects'], sqlite: false },
};

/**
 * @param {string} id recent source id
 * @param {{findProgram: (binary: string) => string|null, sqliteOk: boolean,
 *   dirExists: (relativePath: string) => boolean}} env
 * @returns {{state: 'ok'|'needs-sqlite'|'not-installed', found: string|null}}
 */
export function recentSourceState(id, { findProgram, sqliteOk, dirExists }) {
    const info = RECENT_SOURCE_INFO[id];
    if (!info) return { state: 'not-installed', found: null };
    let found = null;
    for (const binary of info.binaries) {
        found = findProgram(binary);
        if (found) break;
    }
    const installed = Boolean(found) || info.dirs.some((d) => dirExists(d));
    if (!installed) return { state: 'not-installed', found: null };
    if (info.sqlite && !sqliteOk) return { state: 'needs-sqlite', found };
    return { state: 'ok', found };
}

// ---------------------------------------------------------------------------------------------
// actions

const PROJECT_SAMPLE = { path: '/home/alex/code/acme-api', name: 'acme-api' };
const SERVER_SAMPLE = { host: 'staging', user: 'deploy', remoteDir: '/srv/app' };

/** Placeholders offered as chips, per kind of action. */
export const KIND_PLACEHOLDERS = {
    project: PLACEHOLDERS.filter((p) => ['path', 'name'].includes(p)),
    server: PLACEHOLDERS.filter((p) =>
        ['host', 'user', 'remoteDir', 'remoteDirUrl', 'remoteCmd'].includes(p),
    ),
};

/** @returns {string} lower-case id made of letters, digits and dashes */
export function slugify(name) {
    const slug = String(name ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'action';
}

/** @returns {string} an id based on the name that is not in `existingIds` */
export function uniqueActionId(name, existingIds) {
    const base = slugify(name);
    if (!existingIds.includes(base)) return base;
    for (let n = 2; ; n++) {
        const id = `${base}-${n}`;
        if (!existingIds.includes(id)) return id;
    }
}

/**
 * The command template resolved with sample values.
 * @param {string} template
 * @param {'project'|'server'} kind
 * @returns {{args: string[], error: string|null}}
 */
export function previewTemplate(template, kind) {
    try {
        return {
            args: resolve(template, kind === 'server' ? SERVER_SAMPLE : PROJECT_SAMPLE),
            error: null,
        };
    } catch (e) {
        return { args: [], error: e.message };
    }
}

/** @returns {string|null} the program an action starts, or null for a template with no command */
export function programOf(template, kind = 'project') {
    const { args, error } = previewTemplate(template, kind);
    return error || args.length === 0 ? null : args[0];
}

/**
 * Check the action form.
 * @param {{name: string, template: string, runInTerminal: boolean}} form
 * @param {'project'|'server'} kind
 * @returns {string|null} an error message, or null
 */
export function validateAction(form, kind) {
    if (String(form.name ?? '').trim() === '') return 'Enter a name for the action.';
    const template = String(form.template ?? '');
    const { args, error } = previewTemplate(template, kind);
    if (error) return error;
    if (args.length === 0 && !form.runInTerminal) {
        return 'Enter a command, or turn on Run in terminal to just open a terminal.';
    }
    return null;
}

/**
 * Build the stored action object from the form.
 * @param {{name: string, icon: string, template: string, runInTerminal: boolean, cwd?: string,
 *   requiresRemoteDir?: boolean}} form
 * @param {string} id
 * @param {boolean} enabled
 */
export function buildAction(form, id, enabled = true) {
    const action = {
        id,
        name: form.name.trim(),
        icon: form.icon.trim() || 'application-x-executable-symbolic',
        template: form.template.trim(),
        runInTerminal: Boolean(form.runInTerminal),
        requiresRemoteDir: Boolean(form.requiresRemoteDir),
        enabled,
    };
    const cwd = String(form.cwd ?? '').trim();
    if (cwd) action.cwd = cwd;
    return action;
}

/** @returns {object[]} a copy with the item at `index` moved by `delta` places */
export function moveItem(list, index, delta) {
    const to = index + delta;
    if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
    const out = [...list];
    const [item] = out.splice(index, 1);
    out.splice(to, 0, item);
    return out;
}

/**
 * Action for an editor preset, or null when the preset has no template for this kind.
 * Ids match the default actions (`zed`, `zed-remote`), so an added default is not added twice.
 * @param {{id: string, name: string, projectTemplate: string, remoteTemplate: string|null}} preset
 * @param {'project'|'server'} kind
 */
export function actionFromEditorPreset(preset, kind) {
    const template = kind === 'server' ? preset.remoteTemplate : preset.projectTemplate;
    if (!template) return null;
    return {
        id: kind === 'server' ? `${preset.id}-remote` : preset.id,
        name: kind === 'server' ? `${preset.name} remote` : `Open in ${preset.name}`,
        icon: 'text-editor-symbolic',
        template,
        runInTerminal: false,
        requiresRemoteDir: false,
        enabled: true,
    };
}

/**
 * Project action that starts a terminal at the folder. The preset's `{cwd}` becomes `{path}`
 * because direct commands only know the project's values.
 * @param {{id: string, name: string, open: string}} preset
 */
export function actionFromTerminalPreset(preset) {
    return {
        id: `terminal-${preset.id}`,
        name: `Open in ${preset.name}`,
        icon: 'utilities-terminal-symbolic',
        template: preset.open.replaceAll('{cwd}', '{path}'),
        runInTerminal: false,
        requiresRemoteDir: false,
        enabled: true,
    };
}

/**
 * Id that should be the default after the list changed: the current one if it is still there,
 * else the first remaining action, else ''.
 */
export function ensureDefault(actions, currentId) {
    if (actions.some((a) => a.id === currentId)) return currentId;
    return actions[0]?.id ?? '';
}

/**
 * Insert a token at a cursor position.
 * @returns {{text: string, position: number}}
 */
export function insertAtCursor(text, position, token) {
    const at = Math.max(0, Math.min(position, text.length));
    return { text: text.slice(0, at) + token + text.slice(at), position: at + token.length };
}

// ---------------------------------------------------------------------------------------------
// shortcut

const MODIFIER_NAMES = {
    primary: 'Ctrl',
    control: 'Ctrl',
    ctrl: 'Ctrl',
    alt: 'Alt',
    super: 'Super',
    meta: 'Meta',
    hyper: 'Hyper',
    shift: 'Shift',
};
const MODIFIER_KEYS = [
    'Shift_L',
    'Shift_R',
    'Control_L',
    'Control_R',
    'Alt_L',
    'Alt_R',
    'Super_L',
    'Super_R',
    'Meta_L',
    'Meta_R',
    'Hyper_L',
    'Hyper_R',
    'ISO_Level3_Shift',
    'Caps_Lock',
    'Num_Lock',
];

/** @returns {boolean} whether a key name is a modifier on its own */
export function isModifierKey(keyName) {
    return MODIFIER_KEYS.includes(keyName);
}

/** @returns {{mods: string[], key: string}|null} parsed `<Super>j` text, or null */
export function parseAccelerator(accel) {
    const m = /^((?:<[A-Za-z]+>)+)(.+)$/.exec(String(accel ?? '').trim());
    if (!m) return null;
    const mods = [...m[1].matchAll(/<([A-Za-z]+)>/g)].map((x) => x[1]);
    if (mods.some((mod) => !Object.hasOwn(MODIFIER_NAMES, mod.toLowerCase()))) return null;
    return { mods, key: m[2] };
}

/**
 * Readable text for an accelerator: `<Super>j` becomes `Super + J`.
 * @param {string} accel
 * @returns {string} '' for no accelerator, the raw text when it cannot be parsed
 */
export function acceleratorLabel(accel) {
    const text = String(accel ?? '').trim();
    if (text === '') return '';
    const parsed = parseAccelerator(text);
    if (!parsed) return text;
    const parts = parsed.mods.map((mod) => MODIFIER_NAMES[mod.toLowerCase()]);
    parts.push(parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
    return parts.join(' + ');
}

/**
 * A usable shortcut has a real key and at least one of Ctrl, Alt, Super, Meta or Hyper, so it
 * cannot swallow plain typing.
 * @returns {string|null} an error message, or null when the accelerator is fine
 */
export function validateAccelerator(accel) {
    const parsed = parseAccelerator(accel);
    if (!parsed) return 'Press a key combination, for example Super + J.';
    if (isModifierKey(parsed.key) || Object.hasOwn(MODIFIER_NAMES, parsed.key.toLowerCase())) {
        return 'Add a key that is not a modifier.';
    }
    const strong = parsed.mods.some((mod) => MODIFIER_NAMES[mod.toLowerCase()] !== 'Shift');
    if (!strong) return 'Include Ctrl, Alt or Super in the shortcut.';
    return null;
}
