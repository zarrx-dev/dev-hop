import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import { terminalPreset } from '../actions/runner.js';
import { detectInstalled, EDITOR_PRESETS, TERMINAL_PRESETS } from '../core/presets.js';
import { setJSON } from '../settings.js';
import {
    badge,
    emptyRow,
    iconButton,
    iconLabelButton,
    loadActions,
    onSettingsChanged,
    plainRow,
    rowList,
} from './common.js';
import { showDialog } from './dialogs.js';
import {
    actionFromEditorPreset,
    actionFromTerminalPreset,
    buildAction,
    ensureDefault,
    insertAtCursor,
    KIND_PLACEHOLDERS,
    moveItem,
    previewTemplate,
    programOf,
    uniqueActionId,
    validateAction,
} from './model.js';

const KINDS = {
    project: {
        title: 'Project actions',
        description: 'Shown for projects. Placeholders: {path} {name}.',
        key: 'project-actions',
        defaultKey: 'default-project-action',
    },
    server: {
        title: 'Server actions',
        description: 'Shown for servers. Placeholders: {host} {user} {remoteDir}.',
        key: 'server-actions',
        defaultKey: 'default-server-action',
    },
};

const FALLBACK_ICON = 'application-x-executable-symbolic';

/** Cached PATH lookups, so redrawing the list does not stat every folder again. */
function makeFinder() {
    const cache = new Map();
    return (binary) => {
        if (!cache.has(binary)) cache.set(binary, GLib.find_program_in_path(binary));
        return cache.get(binary);
    };
}

/** Save an action list and keep the default action pointing at an action that exists. */
function saveActions(settings, kind, list) {
    const info = KINDS[kind];
    setJSON(settings, info.key, list);
    const current = settings.get_string(info.defaultKey);
    const next = ensureDefault(list, current);
    if (next !== current) settings.set_string(info.defaultKey, next);
}

// ---------------------------------------------------------------------------------------------
// edit dialog

function openActionDialog(page, settings, kind, action, findProgram) {
    const isNew = action === null;
    const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 18 });

    const basics = new Adw.PreferencesGroup();
    const name = new Adw.EntryRow({ title: 'Name', text: action?.name ?? '' });
    basics.add(name);
    const icon = new Adw.EntryRow({ title: 'Icon name', text: action?.icon ?? '' });
    const iconPreview = new Gtk.Image({ icon_name: action?.icon || FALLBACK_ICON });
    icon.add_prefix(iconPreview);
    icon.connect('changed', () =>
        iconPreview.set_from_icon_name(icon.get_text().trim() || FALLBACK_ICON),
    );
    basics.add(icon);
    content.append(basics);

    const command = new Adw.PreferencesGroup({
        title: 'Command',
        description:
            'Split into arguments and run directly, not through a shell. Use quotes around an argument with spaces.',
    });
    const template = new Adw.EntryRow({
        title: 'Command template',
        text: action?.template ?? '',
        css_classes: ['monospace'],
    });
    command.add(template);

    const chips = new Gtk.FlowBox({
        selection_mode: Gtk.SelectionMode.NONE,
        homogeneous: false,
        max_children_per_line: 8,
        row_spacing: 6,
        column_spacing: 6,
        margin_top: 8,
        margin_bottom: 8,
        margin_start: 12,
        margin_end: 12,
    });
    for (const token of KIND_PLACEHOLDERS[kind]) {
        const chip = new Gtk.Button({ label: `{${token}}`, css_classes: ['pill', 'monospace'] });
        chip.connect('clicked', () => {
            const out = insertAtCursor(template.get_text(), template.get_position(), `{${token}}`);
            template.set_text(out.text);
            template.set_position(out.position);
        });
        chips.append(chip);
    }
    const chipRow = new Adw.PreferencesRow({ child: chips, activatable: false, focusable: false });
    chipRow.set_title('Placeholders');
    command.add(chipRow);

    const inTerminal = new Adw.SwitchRow({
        title: 'Run in terminal',
        subtitle: 'Opens the command in your terminal preset.',
        active: action?.runInTerminal === true,
    });
    command.add(inTerminal);

    let cwd = null;
    let needsDir = null;
    if (kind === 'project') {
        cwd = new Adw.EntryRow({
            title: 'Working folder (empty means the project folder)',
            text: action?.cwd ?? '',
            css_classes: ['monospace'],
        });
        command.add(cwd);
    } else {
        needsDir = new Adw.SwitchRow({
            title: 'Only for hosts with a remote folder',
            subtitle: 'The action is hidden for a host that has no remote folder.',
            active: action?.requiresRemoteDir === true,
        });
        command.add(needsDir);
    }
    content.append(command);

    const preview = new Adw.PreferencesGroup({
        title: 'Preview',
        description:
            kind === 'project'
                ? 'Resolved for a sample project. Each box is one argument.'
                : 'Resolved for a sample host. Each box is one argument.',
    });
    const previewRow = new Adw.ActionRow({ title: 'Command', use_markup: false });
    const programRow = new Adw.ActionRow({ title: 'Program', use_markup: false });
    preview.add(previewRow);
    preview.add(programRow);
    content.append(preview);

    let installedBadge = null;
    const refreshPreview = () => {
        const text = template.get_text().trim();
        const { args, error } = previewTemplate(text, kind);
        if (installedBadge) programRow.remove(installedBadge);
        installedBadge = null;
        if (error) {
            previewRow.set_subtitle(error);
            programRow.set_subtitle('');
            return;
        }
        previewRow.set_subtitle(
            args.length > 0
                ? args.map((a) => `[${a}]`).join(' ')
                : 'Opens a terminal at the folder',
        );
        const program = programOf(text, kind);
        if (program === null) {
            programRow.set_subtitle(
                inTerminal.get_active() ? 'The terminal preset' : 'No command to run',
            );
            return;
        }
        const found = findProgram(program);
        programRow.set_subtitle(
            found ? `${program}, found at ${found}` : `${program} was not found`,
        );
        installedBadge = found ? badge('Installed', 'success') : badge('Not installed', 'warning');
        programRow.add_suffix(installedBadge);
    };
    template.connect('changed', refreshPreview);
    inTerminal.connect('notify::active', refreshPreview);
    refreshPreview();

    showDialog(page, {
        title: isNew ? 'New action' : 'Edit action',
        content,
        confirmLabel: isNew ? 'Add' : 'Save',
        width: 560,
        height: 680,
        onConfirm: () => {
            const form = {
                name: name.get_text(),
                icon: icon.get_text(),
                template: template.get_text(),
                runInTerminal: inTerminal.get_active(),
                cwd: cwd?.get_text() ?? '',
                requiresRemoteDir: needsDir?.get_active() ?? false,
            };
            const error = validateAction(form, kind);
            if (error) return error;
            const list = loadActions(settings, kind);
            if (isNew) {
                const id = uniqueActionId(
                    form.name,
                    list.map((a) => a.id),
                );
                saveActions(settings, kind, [...list, buildAction(form, id)]);
            } else {
                saveActions(
                    settings,
                    kind,
                    list.map((a) =>
                        a.id === action.id ? buildAction(form, a.id, a.enabled !== false) : a,
                    ),
                );
            }
            return null;
        },
    });
}

// ---------------------------------------------------------------------------------------------
// preset picker

function presetRows(kind, findProgram) {
    const rows = [];
    const editors = detectInstalled(EDITOR_PRESETS, findProgram)
        .map((p) => ({ preset: p, action: actionFromEditorPreset(p, kind), group: 'Editors' }))
        .filter((r) => r.action);
    rows.push(...editors);
    if (kind === 'project') {
        for (const p of detectInstalled(TERMINAL_PRESETS, findProgram)) {
            rows.push({ preset: p, action: actionFromTerminalPreset(p), group: 'Terminals' });
        }
    }
    return rows;
}

function openPresetDialog(page, settings, kind, findProgram) {
    const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 18 });
    const search = new Gtk.SearchEntry({ placeholder_text: 'Search presets' });
    content.append(search);

    const all = presetRows(kind, findProgram);
    const groups = new Map();
    for (const title of new Set(all.map((r) => r.group))) {
        const group = new Adw.PreferencesGroup({
            title,
            description:
                title === 'Editors'
                    ? 'Installed means the program was found on this computer. Presets for programs that are not installed cannot be added.'
                    : '',
        });
        groups.set(title, { group, rows: rowList(group) });
        content.append(group);
    }

    const render = () => {
        const query = search.get_text().trim().toLowerCase();
        const added = new Set(loadActions(settings, kind).map((a) => a.id));
        for (const [title, target] of groups) {
            const rows = all
                .filter((r) => r.group === title && r.preset.name.toLowerCase().includes(query))
                .map((r) => {
                    const row = plainRow(r.preset.name, r.action.template);
                    row.add_prefix(new Gtk.Image({ icon_name: r.action.icon }));
                    if (added.has(r.action.id)) {
                        row.add_suffix(badge('Added', 'success'));
                    } else if (!r.preset.installed) {
                        row.add_suffix(badge('Not installed'));
                        row.set_sensitive(false);
                    } else {
                        row.add_suffix(badge('Installed', 'success'));
                        const add = new Gtk.Button({ label: 'Add', valign: Gtk.Align.CENTER });
                        add.connect('clicked', () => {
                            const list = loadActions(settings, kind);
                            if (list.some((a) => a.id === r.action.id)) return;
                            saveActions(settings, kind, [...list, r.action]);
                            render();
                        });
                        row.add_suffix(add);
                    }
                    return row;
                });
            target.rows.set(rows);
            target.group.set_visible(rows.length > 0);
        }
    };
    search.connect('search-changed', render);
    render();

    showDialog(page, {
        title: 'Add from preset',
        content,
        confirmLabel: 'Done',
        cancelLabel: null,
        width: 560,
        height: 680,
    });
}

// ---------------------------------------------------------------------------------------------
// the lists

function missingReason(settings, kind, action, findProgram) {
    const text = String(action.template ?? '').trim();
    const { error } = previewTemplate(text, kind);
    if (error) return { text: 'Invalid template', tone: 'error' };
    const program = programOf(text, kind);
    if (program === null) {
        if (action.runInTerminal && terminalPreset(settings, findProgram) === null) {
            return { text: 'Hidden: no terminal found', tone: 'warning' };
        }
        return null;
    }
    if (!findProgram(program)) return { text: `Hidden: ${program} not found`, tone: 'warning' };
    return null;
}

function actionsGroup(page, settings, kind, findProgram) {
    const info = KINDS[kind];
    const group = new Adw.PreferencesGroup({
        title: info.title,
        description: info.description,
    });
    const buttons = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
    const preset = iconLabelButton('list-add-symbolic', 'Add from preset');
    const create = iconLabelButton('list-add-symbolic', 'New action', ['suggested-action']);
    preset.connect('clicked', () => openPresetDialog(page, settings, kind, findProgram));
    create.connect('clicked', () => openActionDialog(page, settings, kind, null, findProgram));
    buttons.append(preset);
    buttons.append(create);
    group.set_header_suffix(buttons);

    let updating = false;
    const defaultRow = new Adw.ComboRow({
        title: 'Default action',
        subtitle: 'Runs on Enter.',
        model: new Gtk.StringList(),
    });
    group.add(defaultRow);
    defaultRow.connect('notify::selected', () => {
        if (updating) return;
        const list = loadActions(settings, kind);
        const chosen = list[defaultRow.get_selected()];
        if (chosen && chosen.id !== settings.get_string(info.defaultKey)) {
            settings.set_string(info.defaultKey, chosen.id);
        }
    });

    const rows = rowList(group);
    // Default badges by action id, so a changed default only flips badges in place.
    let badges = new Map();
    let shownNames = null;
    const syncDefault = () => {
        const list = loadActions(settings, kind);
        const defaultId = settings.get_string(info.defaultKey);
        const index = Math.max(
            0,
            list.findIndex((a) => a.id === defaultId),
        );
        if (defaultRow.get_selected() !== index) {
            updating = true;
            defaultRow.set_selected(index);
            updating = false;
        }
        for (const [id, label] of badges) label.set_visible(id === defaultId);
    };
    const render = () => {
        const list = loadActions(settings, kind);
        const defaultId = settings.get_string(info.defaultKey);
        badges = new Map();

        // Replace the combo's model only when the names changed, never for a new default.
        const names = list.map((a) => a.name);
        if (JSON.stringify(names) !== shownNames) {
            shownNames = JSON.stringify(names);
            updating = true;
            defaultRow.set_model(new Gtk.StringList({ strings: names }));
            updating = false;
        }
        syncDefault();

        const next = list.map((action, index) => {
            const row = new Adw.ActionRow({
                title: action.name,
                subtitle: action.template || 'Opens a terminal at the folder',
                use_markup: false,
                activatable: true,
            });
            row.add_prefix(new Gtk.Image({ icon_name: action.icon || FALLBACK_ICON }));
            const defaultBadge = badge('Default', 'accent');
            defaultBadge.set_visible(action.id === defaultId);
            badges.set(action.id, defaultBadge);
            row.add_suffix(defaultBadge);
            if (action.runInTerminal) row.add_suffix(badge('In terminal'));
            if (action.requiresRemoteDir) row.add_suffix(badge('Needs a remote folder'));
            const missing = missingReason(settings, kind, action, findProgram);
            if (missing) row.add_suffix(badge(missing.text, missing.tone));

            const up = iconButton('go-up-symbolic', 'Move up');
            up.set_sensitive(index > 0);
            up.connect('clicked', () => saveActions(settings, kind, moveItem(list, index, -1)));
            const down = iconButton('go-down-symbolic', 'Move down');
            down.set_sensitive(index < list.length - 1);
            down.connect('clicked', () => saveActions(settings, kind, moveItem(list, index, 1)));
            const remove = iconButton('user-trash-symbolic', 'Delete');
            remove.connect('clicked', () =>
                saveActions(
                    settings,
                    kind,
                    list.filter((a) => a.id !== action.id),
                ),
            );
            const toggle = new Gtk.Switch({
                active: action.enabled !== false,
                valign: Gtk.Align.CENTER,
                tooltip_text: 'Enabled',
            });
            toggle.connect('notify::active', () =>
                saveActions(
                    settings,
                    kind,
                    list.map((a) =>
                        a.id === action.id ? { ...a, enabled: toggle.get_active() } : a,
                    ),
                ),
            );
            for (const w of [up, down, remove, toggle]) row.add_suffix(w);
            row.connect('activated', () =>
                openActionDialog(page, settings, kind, action, findProgram),
            );
            return row;
        });
        rows.set(next.length > 0 ? next : [emptyRow('No actions. Add one from a preset.')]);
    };
    render();
    // Both run from an idle source (see onSettingsChanged). A new default only flips badges.
    onSettingsChanged(page, settings, [info.key, 'terminal-preset'], render);
    onSettingsChanged(page, settings, [info.defaultKey], syncDefault);
    return group;
}

export function buildActionsPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Actions',
        icon_name: 'system-run-symbolic',
    });
    const findProgram = makeFinder();

    const noteGroup = new Adw.PreferencesGroup();
    const note = plainRow(
        'Missing programs are hidden',
        'An action stays in the list and comes back when its program is found. Use the arrows to reorder. The action marked Default runs on Enter.',
    );
    note.add_prefix(new Gtk.Image({ icon_name: 'dialog-information-symbolic' }));
    noteGroup.add(note);
    page.add(noteGroup);

    page.add(actionsGroup(page, settings, 'project', findProgram));
    page.add(actionsGroup(page, settings, 'server', findProgram));
    return page;
}
