// Editor and terminal presets. Templates use the placeholders of template.js.
import { findProgram as findOnSystem } from './programs.js';

/**
 * @typedef {{id: string, name: string, binary: string, icon: string, projectTemplate: string,
 *   remoteTemplate: string|null}} EditorPreset
 * @typedef {{id: string, name: string, binary: string, open: string, run: string}} TerminalPreset
 */

const VSCODE_REMOTE = '--remote ssh-remote+{host} {remoteDir}';

/** @type {EditorPreset[]} */
export const EDITOR_PRESETS = [
    {
        id: 'vscode',
        name: 'VS Code',
        binary: 'code',
        icon: 'visual-studio-code',
        projectTemplate: 'code {path}',
        remoteTemplate: `code ${VSCODE_REMOTE}`,
    },
    {
        id: 'vscodium',
        name: 'VSCodium',
        binary: 'codium',
        icon: 'vscodium',
        projectTemplate: 'codium {path}',
        remoteTemplate: `codium ${VSCODE_REMOTE}`,
    },
    {
        id: 'cursor',
        name: 'Cursor',
        binary: 'cursor',
        icon: 'cursor',
        projectTemplate: 'cursor {path}',
        remoteTemplate: `cursor ${VSCODE_REMOTE}`,
    },
    {
        id: 'zed',
        name: 'Zed',
        binary: 'zed',
        icon: 'zed',
        projectTemplate: 'zed {path}',
        remoteTemplate: 'zed ssh://{host}{remoteDirUrl}',
    },
    {
        id: 'sublime',
        name: 'Sublime Text',
        binary: 'subl',
        icon: 'sublime-text',
        projectTemplate: 'subl {path}',
        remoteTemplate: null,
    },
    {
        id: 'idea',
        name: 'IntelliJ IDEA',
        binary: 'idea',
        icon: 'intellij-idea',
        projectTemplate: 'idea {path}',
        remoteTemplate: null,
    },
    {
        id: 'webstorm',
        name: 'WebStorm',
        binary: 'webstorm',
        icon: 'webstorm',
        projectTemplate: 'webstorm {path}',
        remoteTemplate: null,
    },
    {
        id: 'pycharm',
        name: 'PyCharm',
        binary: 'pycharm',
        icon: 'pycharm',
        projectTemplate: 'pycharm {path}',
        remoteTemplate: null,
    },
];

// gnome-terminal flags are checked with `gnome-terminal --help-all`. The other presets follow
// each terminal's documentation and have not been verified on a live install.
/** @type {TerminalPreset[]} */
export const TERMINAL_PRESETS = [
    {
        id: 'gnome-terminal',
        name: 'GNOME Terminal',
        binary: 'gnome-terminal',
        open: 'gnome-terminal --working-directory={cwd}',
        run: 'gnome-terminal --working-directory={cwd} -- {argv}',
    },
    {
        id: 'ptyxis',
        name: 'Ptyxis',
        binary: 'ptyxis',
        open: 'ptyxis --new-window --working-directory={cwd}',
        run: 'ptyxis --new-window --working-directory={cwd} -- {argv}',
    },
    {
        id: 'kgx',
        name: 'Console',
        binary: 'kgx',
        open: 'kgx --working-directory={cwd}',
        run: 'kgx --working-directory={cwd} -- {argv}',
    },
    {
        id: 'kitty',
        name: 'Kitty',
        binary: 'kitty',
        open: 'kitty --directory {cwd}',
        run: 'kitty --directory {cwd} {argv}',
    },
    {
        id: 'alacritty',
        name: 'Alacritty',
        binary: 'alacritty',
        open: 'alacritty --working-directory {cwd}',
        run: 'alacritty --working-directory {cwd} -e {argv}',
    },
    {
        id: 'wezterm',
        name: 'WezTerm',
        binary: 'wezterm',
        open: 'wezterm start --cwd {cwd}',
        run: 'wezterm start --cwd {cwd} -- {argv}',
    },
    {
        id: 'ghostty',
        name: 'Ghostty',
        binary: 'ghostty',
        open: 'ghostty --working-directory={cwd}',
        run: 'ghostty --working-directory={cwd} -e {argv}',
    },
    {
        id: 'konsole',
        name: 'Konsole',
        binary: 'konsole',
        open: 'konsole --workdir {cwd}',
        run: 'konsole --workdir {cwd} -e {argv}',
    },
    {
        id: 'tilix',
        name: 'Tilix',
        binary: 'tilix',
        open: 'tilix --working-directory={cwd}',
        run: 'tilix --working-directory={cwd} -e {cmdline}',
    },
];

/** Order tried by autoTerminal. */
export const AUTO_TERMINAL_ORDER = [
    'ptyxis',
    'gnome-terminal',
    'kgx',
    'kitty',
    'ghostty',
    'wezterm',
    'alacritty',
    'konsole',
    'tilix',
];

/**
 * @template {{binary: string}} P
 * @param {P[]} presets
 * @param {(binary: string) => string|null} [findProgram]
 * @returns {(P & {installed: boolean})[]}
 */
export function detectInstalled(presets, findProgram = findOnSystem) {
    return presets.map((p) => ({ ...p, installed: Boolean(findProgram(p.binary)) }));
}

/**
 * @param {(binary: string) => string|null} [findProgram]
 * @returns {TerminalPreset|null} the first installed terminal in AUTO_TERMINAL_ORDER
 */
export function autoTerminal(findProgram = findOnSystem) {
    for (const id of AUTO_TERMINAL_ORDER) {
        const preset = TERMINAL_PRESETS.find((p) => p.id === id);
        if (preset && findProgram(preset.binary)) return preset;
    }
    return null;
}
