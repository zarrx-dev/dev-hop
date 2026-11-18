import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import { addHost, deleteHost, loadWithIncludes, updateHost } from '../core/sshConfig.js';
import { getJSON, setJSON } from '../settings.js';
import { shortenHome } from '../ui/model.js';
import {
    badge,
    comboRow,
    emptyRow,
    iconButton,
    iconLabelButton,
    loadActions,
    onSettingsChanged,
    plainRow,
    rowList,
    toast,
} from './common.js';
import { confirmDialog, showDialog } from './dialogs.js';
import { buildHostChange, hostSubtitle, removeServerMeta, updateServerMeta } from './model.js';
import { applyChange, configPath, findBlockIndex } from './sshStore.js';

const GLOBAL_DEFAULT = 'Use global default';
const FIELD_LABELS = [
    ['HostName', 'HostName', ''],
    ['User', 'User', ''],
    ['Port', 'Port', ''],
    ['IdentityFile', 'IdentityFile', ''],
    ['ProxyJump', 'ProxyJump', 'none'],
];

function readMeta(settings) {
    const meta = getJSON(settings, 'server-meta', '{}');
    return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
}

/** @returns {{model: object, hosts: object[]}} a fresh read of the config and its includes */
function loadHosts(settings) {
    return loadWithIncludes(configPath(settings));
}

function backupMessage(backup) {
    return backup
        ? `Saved. Backup: ${GLib.path_get_basename(backup)}`
        : 'Saved. The file did not exist, so there is no backup.';
}

/**
 * The host dialog. `entry` is null for a new host. A host from an Include file has
 * `entry.editable === false`: only the dev-hop settings can be changed.
 */
function openHostDialog(page, settings, entry, refresh) {
    const path = configPath(settings);
    const display = shortenHome(path, GLib.get_home_dir());
    const isNew = entry === null;
    const readOnly = !isNew && !entry.editable;
    const ownAlias = isNew ? null : entry.aliases[0];
    const meta = isNew ? {} : (readMeta(settings)[ownAlias] ?? {});
    const serverActions = loadActions(settings, 'server');

    const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 18 });
    const entries = {};

    if (!readOnly) {
        const group = new Adw.PreferencesGroup({
            title: `In ${display}`,
            description: "Written to this host's block. Other lines are left alone.",
        });
        const alias = new Adw.EntryRow({ title: 'Host alias', text: ownAlias ?? '' });
        entries.alias = alias;
        group.add(alias);
        for (const [key, title, placeholder] of FIELD_LABELS) {
            const row = new Adw.EntryRow({ title, text: entry?.fields[key] ?? '' });
            if (placeholder) row.set_tooltip_text(`Leave empty for ${placeholder}`);
            entries[key] = row;
            group.add(row);
        }
        content.append(group);
    } else {
        const group = new Adw.PreferencesGroup({
            title: 'Defined in an Include file',
            description: `${entry.source}. Edit that file to change the host. dev-hop cannot write it.`,
        });
        group.add(plainRow(ownAlias, hostSubtitle(entry)));
        content.append(group);
    }

    const stored = new Adw.PreferencesGroup({
        title: 'Stored by dev-hop',
        description: "Not written to ssh config. Kept in dev-hop's own settings.",
    });
    const remoteDir = new Adw.EntryRow({ title: 'Remote folder', text: meta.remoteDir ?? '' });
    remoteDir.set_tooltip_text('Used by SSH to folder and the remote editors.');
    stored.add(remoteDir);
    const selected = Math.max(0, serverActions.findIndex((a) => a.id === meta.defaultAction) + 1);
    const defaultRow = comboRow(
        'Default action',
        'Runs when you press Enter on this server.',
        [GLOBAL_DEFAULT, ...serverActions.map((a) => a.name)],
        selected,
    );
    stored.add(defaultRow);
    content.append(stored);

    if (!readOnly) {
        const note = new Adw.PreferencesGroup();
        const noteRow = plainRow(`A backup of ${display} is saved before this change.`);
        noteRow.add_prefix(new Gtk.Image({ icon_name: 'document-save-symbolic' }));
        note.add(noteRow);
        content.append(note);
    }

    let dialog = null;
    if (!isNew && !readOnly) {
        const danger = new Adw.PreferencesGroup();
        const row = plainRow('Delete host', `Removes the Host block from ${display}.`);
        const del = new Gtk.Button({
            label: 'Delete...',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        del.connect('clicked', () => confirmDelete(page, settings, entry, refresh, dialog));
        row.add_suffix(del);
        danger.add(row);
        content.append(danger);
    }

    const defaultActionId = () => {
        const index = defaultRow.get_selected();
        return index > 0 ? serverActions[index - 1].id : '';
    };

    dialog = showDialog(page, {
        title: isNew ? 'Add host' : readOnly ? ownAlias : `Edit host: ${ownAlias}`,
        content,
        confirmLabel: isNew ? 'Add' : 'Save',
        width: 520,
        height: 640,
        onConfirm: () => {
            try {
                if (readOnly) {
                    setJSON(
                        settings,
                        'server-meta',
                        updateServerMeta(readMeta(settings), ownAlias, {
                            remoteDir: remoteDir.get_text().trim(),
                            defaultAction: defaultActionId(),
                        }),
                    );
                    refresh();
                    return null;
                }
                const form = { alias: entries.alias.get_text() };
                for (const [key] of FIELD_LABELS) form[key] = entries[key].get_text();
                // A fresh read, so aliases added outside this window count as taken.
                const taken = loadHosts(settings).hosts.flatMap((h) => h.aliases);
                const change = buildHostChange(form, {
                    taken,
                    own: ownAlias,
                    restAliases: isNew ? [] : entry.aliases.slice(1),
                });
                if (!change.ok) return change.message;

                const { backup } = applyChange(path, (model) => {
                    if (isNew) {
                        addHost(model, change.aliases, change.fields);
                        return;
                    }
                    const index = findBlockIndex(model, ownAlias);
                    if (index < 0)
                        throw new Error(`Host "${ownAlias}" is no longer in ${display}.`);
                    updateHost(model, index, { aliases: change.aliases, ...change.fields });
                });
                const newAlias = change.aliases[0];
                setJSON(
                    settings,
                    'server-meta',
                    updateServerMeta(readMeta(settings), ownAlias ?? newAlias, {
                        rename: newAlias,
                        remoteDir: remoteDir.get_text().trim(),
                        defaultAction: defaultActionId(),
                    }),
                );
                refresh();
                toast(page, backupMessage(backup));
                return null;
            } catch (e) {
                return e.message;
            }
        },
    });
}

function confirmDelete(page, settings, entry, refresh, parentDialog) {
    const alias = entry.aliases[0];
    const display = shortenHome(configPath(settings), GLib.get_home_dir());
    confirmDialog(page, {
        heading: `Delete host "${alias}"?`,
        body: `This removes its Host block from ${display}. A backup of the file is saved first and every other line stays as it is. The remote folder and default action dev-hop stored for this host are removed too.`,
        confirmLabel: 'Delete',
        destructive: true,
        onConfirm: () => {
            try {
                const { backup } = applyChange(configPath(settings), (model) => {
                    const index = findBlockIndex(model, alias);
                    if (index < 0) throw new Error(`Host "${alias}" is no longer in ${display}.`);
                    deleteHost(model, index);
                });
                setJSON(settings, 'server-meta', removeServerMeta(readMeta(settings), alias));
                parentDialog?.close();
                refresh();
                toast(page, `Deleted "${alias}". ${backupMessage(backup)}`);
            } catch (e) {
                toast(page, `Could not delete: ${e.message}`);
            }
        },
    });
}

export function buildServersPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Servers',
        icon_name: 'network-server-symbolic',
    });
    const home = GLib.get_home_dir();
    const display = () => shortenHome(configPath(settings), home);

    const noteGroup = new Adw.PreferencesGroup();
    const note = plainRow('Backups are saved before every change');
    note.add_prefix(new Gtk.Image({ icon_name: 'document-save-symbolic' }));
    noteGroup.add(note);
    page.add(noteGroup);

    const group = new Adw.PreferencesGroup({ title: 'SSH hosts' });
    const add = iconLabelButton('list-add-symbolic', 'Add host', ['suggested-action']);
    group.set_header_suffix(add);
    page.add(group);

    const rows = rowList(group);
    const refresh = () => {
        note.set_subtitle(
            `Before each save dev-hop writes a copy such as config.20261117-143205.bak next to ${display()}, then changes only the edited Host block.`,
        );
        group.set_description(`Read from ${display()}. Patterns with * or ? are not listed.`);
        let hosts = [];
        try {
            hosts = loadHosts(settings).hosts;
        } catch (e) {
            rows.set([emptyRow(`Could not read the ssh config: ${e.message}`)]);
            return;
        }
        const meta = readMeta(settings);
        const actions = loadActions(settings, 'server');
        const next = hosts.map((entry) => {
            const alias = entry.aliases[0];
            const m = Object.hasOwn(meta, alias) ? meta[alias] : {};
            const row = new Adw.ActionRow({
                title: alias,
                subtitle: hostSubtitle(entry, m.remoteDir ?? ''),
                use_markup: false,
                activatable: true,
            });
            row.add_prefix(new Gtk.Image({ icon_name: 'network-server-symbolic' }));
            const action = actions.find((a) => a.id === m.defaultAction);
            if (action) row.add_suffix(badge(action.name, 'accent'));
            if (!m.remoteDir) row.add_suffix(badge('No remote folder'));
            if (entry.editable) {
                const del = iconButton('user-trash-symbolic', 'Delete host', ['circular']);
                del.connect('clicked', () => confirmDelete(page, settings, entry, refresh, null));
                row.add_suffix(del);
            } else {
                const file = GLib.path_get_basename(entry.source ?? '');
                row.add_suffix(badge(`Read-only, from ${file}`));
            }
            row.connect('activated', () => openHostDialog(page, settings, entry, refresh));
            return row;
        });
        rows.set(next.length > 0 ? next : [emptyRow(`No hosts found in ${display()}`)]);
    };
    add.connect('clicked', () => openHostDialog(page, settings, null, refresh));
    refresh();
    onSettingsChanged(
        page,
        settings,
        ['ssh-config-path', 'server-meta', 'server-actions'],
        refresh,
    );
    return page;
}
