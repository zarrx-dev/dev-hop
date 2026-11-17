// Command templates: split into arguments first, substitute placeholders second, so a value
// can never add or change arguments and nothing goes through a shell.
import GLib from 'gi://GLib';

/** Placeholders a template may use. */
export const PLACEHOLDERS = [
    'path',
    'name',
    'host',
    'user',
    'remoteDir',
    'remoteDirUrl',
    'remoteCmd',
    'cwd',
    'cmdline',
];

function splitTemplate(template) {
    if (!template || template.trim() === '') return [];
    try {
        return GLib.shell_parse_argv(template)[1];
    } catch (e) {
        throw new Error(`Cannot parse command template "${template}": ${e.message}`);
    }
}

/** Quote a remote folder for the remote shell, keeping a leading ~ or ~/ expandable. */
function quoteRemoteDir(dir) {
    if (dir === '~') return '~';
    if (dir.startsWith('~/')) return `~/${dir.length > 2 ? GLib.shell_quote(dir.slice(2)) : ''}`;
    return GLib.shell_quote(dir);
}

function computeValues(vars) {
    const remoteDir = vars.remoteDir ?? '';
    const values = {
        path: vars.path ?? '',
        name: vars.name ?? '',
        host: vars.host ?? '',
        user: vars.user ?? '',
        remoteDir,
        remoteDirUrl: remoteDir === '' || remoteDir.startsWith('/') ? remoteDir : `/${remoteDir}`,
        remoteCmd:
            remoteDir === ''
                ? 'exec "$SHELL" -l'
                : `cd ${quoteRemoteDir(remoteDir)}; exec "$SHELL" -l`,
        cwd: vars.cwd ?? '',
        cmdline: vars.cmdline ?? '',
    };
    return values;
}

function substitute(arg, values) {
    return arg.replace(/\{(\w+)\}/g, (_m, name) => {
        if (!Object.hasOwn(values, name)) throw new Error(`Unknown placeholder {${name}}`);
        return values[name];
    });
}

/**
 * Turn a template into an argv array. `remoteCmd` is `cd <dir>; exec "$SHELL" -l` with the
 * folder quoted (a leading `~/` stays unquoted); `remoteDirUrl` is remoteDir with a leading
 * `/` (for `ssh://host/~/app`). Missing variables become empty strings.
 * @param {string} template
 * @param {{path?: string, name?: string, host?: string, user?: string, remoteDir?: string,
 *   cwd?: string, cmdline?: string}} [vars]
 * @returns {string[]}
 * @throws {Error} on an unknown placeholder or a template that cannot be parsed
 */
export function resolve(template, vars = {}) {
    const values = computeValues(vars);
    return splitTemplate(template).map((arg) => substitute(arg, values));
}

/** @param {string[]} argv @returns {string} each argument shell-quoted, joined with spaces */
export function toCmdline(argv) {
    return argv.map((a) => GLib.shell_quote(a)).join(' ');
}

/**
 * Build the full argv that runs `argv` (or just opens a window, when empty) in a terminal.
 * An empty argv uses the preset's `open` template, otherwise its `run` template, where a
 * standalone `{argv}` token is replaced by the elements as separate arguments and `{cmdline}`
 * inside an argument by the shell-quoted command line.
 * @param {{open: string, run: string}} preset
 * @param {string} cwd
 * @param {string[]} argv
 * @returns {string[]}
 */
export function wrapInTerminal(preset, cwd, argv) {
    if (argv.length === 0) return resolve(preset.open, { cwd });
    const values = computeValues({ cwd, cmdline: toCmdline(argv) });
    const out = [];
    for (const arg of splitTemplate(preset.run)) {
        if (arg === '{argv}') out.push(...argv);
        else out.push(substitute(arg, values));
    }
    return out;
}
