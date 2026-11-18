// Small widget helpers shared by the preferences pages.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import { getJSON } from '../settings.js';

/** The action list of a kind, without entries that have no id. */
export function loadActions(settings, kind) {
    const list = getJSON(settings, kind === 'server' ? 'server-actions' : 'project-actions', '[]');
    return Array.isArray(list) ? list.filter((a) => a && typeof a.id === 'string') : [];
}

/** A ComboRow listing `labels`, with `selected` as the chosen index. */
export function comboRow(title, subtitle, labels, selected = 0) {
    const row = new Adw.ComboRow({
        title,
        subtitle,
        use_markup: false,
        model: new Gtk.StringList({ strings: labels }),
    });
    row.set_selected(Math.max(0, selected));
    return row;
}

/** A flat, icon-only button. */
export function iconButton(iconName, tooltip, extraClasses = []) {
    return new Gtk.Button({
        icon_name: iconName,
        tooltip_text: tooltip,
        valign: Gtk.Align.CENTER,
        css_classes: ['flat', ...extraClasses],
    });
}

/** A button with an icon and a label, for group headers. */
export function iconLabelButton(iconName, label, extraClasses = []) {
    return new Gtk.Button({
        child: new Adw.ButtonContent({ icon_name: iconName, label }),
        valign: Gtk.Align.CENTER,
        css_classes: extraClasses,
    });
}

/**
 * A small status label for the end of a row.
 * @param {string} text
 * @param {'accent'|'success'|'warning'|'error'|'dim-label'} [tone]
 */
export function badge(text, tone = 'dim-label') {
    return new Gtk.Label({
        label: text,
        valign: Gtk.Align.CENTER,
        css_classes: ['caption', tone],
    });
}

/** Show a toast in the window that holds `widget`. */
export function toast(widget, title) {
    const root = widget.get_root();
    if (root && typeof root.add_toast === 'function') {
        root.add_toast(new Adw.Toast({ title, use_markup: false, timeout: 6 }));
    }
}

/**
 * Ask for a folder. Dismissing the chooser does nothing.
 * @param {Gtk.Widget} widget a widget inside the window
 * @param {string} title
 * @param {(path: string) => void} callback
 */
export function chooseFolder(widget, title, callback) {
    const chooser = new Gtk.FileDialog({ title, modal: true });
    chooser.select_folder(widget.get_root(), null, (dialog, result) => {
        try {
            const path = dialog.select_folder_finish(result)?.get_path();
            if (path) callback(path);
        } catch (_e) {
            // Dismissed.
        }
    });
}

/** A group's rows that can be swapped for a new set. */
export function rowList(group) {
    let rows = [];
    return {
        set(next) {
            for (const row of rows) group.remove(row);
            rows = next;
            for (const row of rows) group.add(row);
        },
    };
}

/** A dimmed row that says there is nothing to list. */
export function emptyRow(text) {
    return new Adw.ActionRow({ title: text, use_markup: false, css_classes: ['dim-label'] });
}

/** An ActionRow that shows its text as plain text, not Pango markup. */
export function plainRow(title, subtitle = '') {
    return new Adw.ActionRow({ title, subtitle, use_markup: false });
}

/**
 * Run `fn` when any of the settings keys change, and stop when the page goes away.
 * @param {Gtk.Widget} widget
 * @param {object} settings
 * @param {string[]} keys
 * @param {() => void} fn
 */
export function onSettingsChanged(widget, settings, keys, fn) {
    // The callback runs from an idle source, never inside the signal that changed the setting:
    // a widget such as a combo's popover may still be in use while the signal is emitted.
    let idle = 0;
    const later = () => {
        if (idle) return;
        idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            idle = 0;
            fn();
            return GLib.SOURCE_REMOVE;
        });
    };
    const ids = keys.map((key) => settings.connect(`changed::${key}`, later));
    widget.connect('unrealize', () => {
        for (const id of ids) settings.disconnect(id);
        ids.length = 0;
        if (idle) GLib.source_remove(idle);
        idle = 0;
    });
}
