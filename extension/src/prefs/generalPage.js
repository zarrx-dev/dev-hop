import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import { autoTerminal, detectInstalled, TERMINAL_PRESETS } from '../core/presets.js';
import { comboRow, onSettingsChanged } from './common.js';
import { showDialog } from './dialogs.js';
import { acceleratorLabel, isModifierKey, validateAccelerator } from './model.js';

const TOGGLE_KEY = 'toggle-popup';
const PASS_THROUGH = ['Escape', 'Return', 'KP_Enter', 'Tab', 'ISO_Left_Tab'];

function currentAccelerator(settings) {
    return settings.get_strv(TOGGLE_KEY)[0] ?? '';
}

/** The shortcut capture dialog: press the keys, or type the accelerator text. */
function openShortcutDialog(page, settings) {
    const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        halign: Gtk.Align.FILL,
    });
    content.append(new Gtk.Image({ icon_name: 'input-keyboard-symbolic', pixel_size: 48 }));
    content.append(
        new Gtk.Label({
            label: 'Press the keys you want to use for the search popup.',
            wrap: true,
            justify: Gtk.Justification.CENTER,
        }),
    );
    const shown = new Gtk.Label({ css_classes: ['title-2'] });
    content.append(shown);

    const group = new Adw.PreferencesGroup();
    const entry = new Adw.EntryRow({
        title: 'Or type it, for example <Super>j',
        use_markup: false,
        text: currentAccelerator(settings),
    });
    group.add(entry);
    content.append(group);
    const refreshShown = () => shown.set_label(acceleratorLabel(entry.get_text()) || 'No shortcut');
    entry.connect('changed', refreshShown);
    refreshShown();

    // While the entry has the keyboard, typing goes there instead of being captured.
    const focus = new Gtk.EventControllerFocus();
    entry.add_controller(focus);

    // Ask the compositor to stop handling shortcuts, so the current Super + J reaches this dialog.
    let surface = null;
    content.connect('map', () => {
        try {
            surface = content.get_native()?.get_surface() ?? null;
            surface?.inhibit_system_shortcuts?.(null);
        } catch (_e) {
            surface = null;
        }
    });
    const release = () => {
        try {
            surface?.restore_system_shortcuts?.();
        } catch (_e) {
            // The surface is already gone.
        }
        surface = null;
    };
    content.connect('unmap', release);

    showDialog(page, {
        title: 'Open search popup',
        content,
        confirmLabel: 'Set shortcut',
        width: 440,
        height: 420,
        onClose: release,
        captureKeys: (keyval, _keycode, state) => {
            if (focus.contains_focus) return false;
            const mask = state & Gtk.accelerator_get_default_mod_mask();
            const name = Gdk.keyval_name(keyval) ?? '';
            if (mask === 0 && PASS_THROUGH.includes(name)) return false;
            if (isModifierKey(name)) return true;
            entry.set_text(Gtk.accelerator_name(Gdk.keyval_to_lower(keyval), mask));
            return true;
        },
        onConfirm: () => {
            const text = entry.get_text().trim();
            const problem = validateAccelerator(text);
            if (problem) return problem;
            const [ok] = Gtk.accelerator_parse(text);
            if (!ok) return 'That is not a valid shortcut.';
            settings.set_strv(TOGGLE_KEY, [text]);
            return null;
        },
    });
}

function shortcutGroup(page, settings) {
    const group = new Adw.PreferencesGroup({ title: 'Shortcut' });
    const row = new Adw.ActionRow({
        title: 'Open search popup',
        subtitle: 'Press Change, then the keys you want to use.',
        use_markup: false,
    });
    row.add_prefix(new Gtk.Image({ icon_name: 'input-keyboard-symbolic' }));
    const label = new Gtk.Label({ valign: Gtk.Align.CENTER, css_classes: ['heading'] });
    const change = new Gtk.Button({ label: 'Change...', valign: Gtk.Align.CENTER });
    const reset = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        tooltip_text: 'Reset to the default',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    const refresh = () => label.set_label(acceleratorLabel(currentAccelerator(settings)) || 'None');
    change.connect('clicked', () => openShortcutDialog(page, settings));
    reset.connect('clicked', () => settings.reset(TOGGLE_KEY));
    row.add_suffix(label);
    row.add_suffix(reset);
    row.add_suffix(change);
    group.add(row);
    refresh();
    onSettingsChanged(page, settings, [TOGGLE_KEY], refresh);
    return group;
}

function terminalGroup(settings) {
    const group = new Adw.PreferencesGroup({ title: 'Terminal' });
    const installed = detectInstalled(TERMINAL_PRESETS).filter((p) => p.installed);
    const auto = autoTerminal();
    const ids = ['', ...installed.map((p) => p.id)];
    const labels = [
        auto ? `Auto (${auto.name})` : 'Auto (none found)',
        ...installed.map((p) => p.name),
    ];
    const stored = settings.get_string('terminal-preset');
    if (stored !== '' && !ids.includes(stored)) {
        const known = TERMINAL_PRESETS.find((p) => p.id === stored);
        ids.push(stored);
        labels.push(`${known?.name ?? stored} (not installed)`);
    }
    const row = comboRow(
        'Terminal',
        'Used by actions with Run in terminal turned on. Only installed terminals are listed.',
        labels,
        Math.max(0, ids.indexOf(stored)),
    );
    row.add_prefix(new Gtk.Image({ icon_name: 'utilities-terminal-symbolic' }));
    row.connect('notify::selected', () => {
        const id = ids[row.get_selected()] ?? '';
        if (id !== settings.get_string('terminal-preset'))
            settings.set_string('terminal-preset', id);
    });
    group.add(row);
    return group;
}

function indicatorGroup(settings) {
    const group = new Adw.PreferencesGroup({ title: 'Top bar' });
    const row = new Adw.SwitchRow({
        title: 'Show panel icon',
        subtitle: 'The search shortcut keeps working when the icon is hidden.',
    });
    settings.bind('show-indicator', row, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(row);
    return group;
}

function listsGroup(settings) {
    const group = new Adw.PreferencesGroup({ title: 'Lists' });
    const recent = new Adw.SpinRow({
        title: 'Maximum recent items',
        subtitle: 'How many recent projects each tool adds to the menu and popup.',
        adjustment: new Gtk.Adjustment({
            lower: 1,
            upper: 50,
            step_increment: 1,
            page_increment: 5,
            value: settings.get_int('max-recent'),
        }),
    });
    settings.bind('max-recent', recent, 'value', Gio.SettingsBindFlags.DEFAULT);
    group.add(recent);

    const worktrees = new Adw.SwitchRow({
        title: 'Include git worktrees',
        subtitle: 'Show each linked worktree as its own project.',
    });
    settings.bind('include-worktrees', worktrees, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(worktrees);
    return group;
}

function sshGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'SSH',
        description:
            'The file the Servers page reads and edits. A backup is saved before each change.',
    });
    const row = new Adw.EntryRow({
        title: 'SSH config file',
        text: settings.get_string('ssh-config-path'),
        show_apply_button: true,
    });
    row.connect('apply', () => {
        const text = row.get_text().trim();
        if (text === '') {
            settings.reset('ssh-config-path');
            row.set_text(settings.get_string('ssh-config-path'));
        } else {
            settings.set_string('ssh-config-path', text);
        }
    });
    row.set_tooltip_text(`Default: ${GLib.build_filenamev(['~', '.ssh', 'config'])}`);
    group.add(row);
    return group;
}

export function buildGeneralPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'General',
        icon_name: 'preferences-system-symbolic',
    });
    page.add(shortcutGroup(page, settings));
    page.add(terminalGroup(settings));
    page.add(indicatorGroup(settings));
    page.add(listsGroup(settings));
    page.add(sshGroup(settings));
    return page;
}
