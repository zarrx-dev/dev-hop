import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { autoTerminal, TERMINAL_PRESETS } from '../core/presets.js';
import { resolve, wrapInTerminal } from '../core/template.js';
import { getJSON } from '../settings.js';

const KEYS = {
    project: { actions: 'project-actions', default: 'default-project-action' },
    server: { actions: 'server-actions', default: 'default-server-action' },
};

function varsFor(kind, item) {
    if (kind === 'project') return { path: item.path, name: item.name };
    return { host: item.host, user: item.user, remoteDir: item.remoteDir };
}

function cwdFor(kind, item) {
    return kind === 'project' ? item.path : GLib.get_home_dir();
}

/**
 * Resolve a template, dropping an argument that is a lone placeholder with an empty value, so
 * `code --remote ssh-remote+host {remoteDir}` without a folder loses its last argument.
 */
function resolveArgs(template, vars) {
    const argv = resolve(template, vars);
    if (!template || template.trim() === '') return argv;
    const raw = GLib.shell_parse_argv(template)[1];
    return argv.filter((arg, i) => !(arg === '' && /^\{\w+\}$/.test(raw[i])));
}

/** @returns {object|null} the terminal preset to use, or null when none is installed */
export function terminalPreset(settings, findProgram = GLib.find_program_in_path) {
    const id = settings.get_string('terminal-preset');
    if (id) {
        const preset = TERMINAL_PRESETS.find((p) => p.id === id);
        if (preset && findProgram(preset.binary)) return preset;
    }
    return autoTerminal(findProgram);
}

/**
 * Actions that can run for this item, each with `isDefault`. Hidden: disabled actions, ones that
 * need a remote folder the server lacks, and ones whose program or terminal is not installed.
 * @param {object} settings
 * @param {'project'|'server'} kind
 * @param {object} item
 * @param {(binary: string) => string|null} [findProgram]
 */
export function availableActions(settings, kind, item, findProgram = GLib.find_program_in_path) {
    const keys = KEYS[kind];
    const all = getJSON(settings, keys.actions, '[]');
    if (!Array.isArray(all)) return [];
    const vars = varsFor(kind, item);
    const noTerminal = terminalPreset(settings, findProgram) === null;
    const available = all.filter((action) => {
        if (action.enabled === false) return false;
        if (action.requiresRemoteDir && !item.remoteDir) return false;
        let argv;
        try {
            argv = resolveArgs(action.template, vars);
        } catch (_e) {
            return false;
        }
        if (action.runInTerminal && noTerminal) return false;
        if (argv.length === 0) return Boolean(action.runInTerminal);
        return Boolean(findProgram(argv[0]));
    });
    const wanted = [item.defaultAction, settings.get_string(keys.default)];
    const chosen = wanted.find((id) => id && available.some((a) => a.id === id));
    const defaultId = chosen ?? available[0]?.id;
    return available.map((a) => ({ ...a, isDefault: a.id === defaultId }));
}

/**
 * The command for an action. Pure: nothing is spawned.
 * @returns {{argv: string[], cwd: string}}
 * @throws {Error} when the action runs in a terminal and none is installed, or the template is bad
 */
export function buildCommand(
    settings,
    kind,
    item,
    action,
    findProgram = GLib.find_program_in_path,
) {
    const argv = resolveArgs(action.template, varsFor(kind, item));
    const cwd = cwdFor(kind, item);
    if (!action.runInTerminal) return { argv, cwd };
    const preset = terminalPreset(settings, findProgram);
    if (!preset) throw new Error('No terminal is installed');
    return { argv: wrapInTerminal(preset, cwd, argv), cwd };
}

/**
 * Start an action detached. Never throws.
 * @returns {{ok: true}|{ok: false, error: string}}
 */
export function run(settings, kind, item, action, findProgram = GLib.find_program_in_path) {
    try {
        const { argv, cwd } = buildCommand(settings, kind, item, action, findProgram);
        if (argv.length === 0) return { ok: false, error: 'The action has no command' };
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        launcher.set_cwd(cwd);
        const proc = launcher.spawnv(argv);
        proc.wait_async(null, (p, res) => {
            try {
                p.wait_finish(res);
            } catch (_e) {
                // Only reaping the child.
            }
        });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}
