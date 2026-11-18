import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import { findProgram } from '../core/programs.js';
import { getJSON, setJSON } from '../settings.js';
import { MAX_REPOS, scanGit } from '../sources/gitScan.js';
import { RECENT_READERS } from '../sources/manager.js';
import { baseName } from '../sources/paths.js';
import { sqliteAvailable } from '../sources/recent/sqlite.js';
import { shortenHome } from '../ui/model.js';
import {
    badge,
    chooseFolder,
    comboRow,
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
    formatNameList,
    parseNameList,
    RECENT_SOURCE_INFO,
    recentSourceState,
    updateOverride,
} from './model.js';

const GLOBAL_DEFAULT = 'Use global default';

function readList(settings, key) {
    const list = getJSON(settings, key, '[]');
    return Array.isArray(list) ? list : [];
}

function readObject(settings, key) {
    const value = getJSON(settings, key, '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function pinnedPaths(settings) {
    return readList(settings, 'pinned')
        .map((e) => e?.path)
        .filter((p) => typeof p === 'string' && p !== '');
}

function setOverride(settings, path, patch) {
    setJSON(
        settings,
        'item-overrides',
        updateOverride(readObject(settings, 'item-overrides'), path, patch),
    );
}

function removePinned(settings, path) {
    setJSON(
        settings,
        'pinned',
        readList(settings, 'pinned').filter((e) => e?.path !== path),
    );
    setOverride(settings, path, { defaultAction: '', hidden: false });
}

/** The per-project dialog: default action, hide, remove. */
function openProjectDialog(page, settings, path) {
    const home = GLib.get_home_dir();
    const current = readObject(settings, 'item-overrides')[path] ?? {};
    const actions = loadActions(settings, 'project');
    const labels = [GLOBAL_DEFAULT, ...actions.map((a) => a.name)];
    const selected = Math.max(0, actions.findIndex((a) => a.id === current.defaultAction) + 1);

    const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 18 });

    const folderGroup = new Adw.PreferencesGroup();
    folderGroup.add(plainRow('Folder', shortenHome(path, home)));
    content.append(folderGroup);

    const actionGroup = new Adw.PreferencesGroup({
        title: 'Default action',
        description:
            'Runs when you press Enter on this project. The other actions stay under Shift+Enter.',
    });
    const actionRow = comboRow(
        'Action for this project',
        'Overrides the global default.',
        labels,
        selected,
    );
    actionGroup.add(actionRow);
    content.append(actionGroup);

    const visibility = new Adw.PreferencesGroup({ title: 'Visibility' });
    const hideRow = new Adw.SwitchRow({
        title: 'Hide from lists',
        subtitle: 'The folder stays on disk. Show it again from this page.',
        active: current.hidden === true,
    });
    visibility.add(hideRow);
    const removeRow = new Adw.ActionRow({
        title: 'Remove bookmark',
        subtitle: 'Auto-discovery may still list it if it is a git repository.',
    });
    const removeButton = new Gtk.Button({
        label: 'Remove',
        valign: Gtk.Align.CENTER,
        css_classes: ['destructive-action'],
    });
    removeRow.add_suffix(removeButton);
    visibility.add(removeRow);
    content.append(visibility);

    const dialog = showDialog(page, {
        title: baseName(path),
        content,
        confirmLabel: 'Save',
        width: 480,
        height: 520,
        onConfirm: () => {
            const index = actionRow.get_selected();
            setOverride(settings, path, {
                defaultAction: index > 0 ? actions[index - 1].id : '',
                hidden: hideRow.get_active(),
            });
            return null;
        },
    });
    removeButton.connect('clicked', () => {
        removePinned(settings, path);
        dialog.close();
    });
}

function pinnedGroup(page, settings) {
    const home = GLib.get_home_dir();
    const group = new Adw.PreferencesGroup({
        title: 'Pinned',
        description: 'Folders you added by hand. They always show first.',
    });
    const add = iconLabelButton('list-add-symbolic', 'Add folder');
    add.connect('clicked', () =>
        chooseFolder(page, 'Pin a folder', (path) => {
            const list = readList(settings, 'pinned');
            if (list.some((e) => e?.path === path)) return;
            setJSON(settings, 'pinned', [...list, { path }]);
        }),
    );
    group.set_header_suffix(add);

    const rows = rowList(group);
    const render = () => {
        const overrides = readObject(settings, 'item-overrides');
        const actions = loadActions(settings, 'project');
        const next = pinnedPaths(settings).map((path) => {
            const row = new Adw.ActionRow({
                title: baseName(path),
                subtitle: shortenHome(path, home),
                use_markup: false,
                activatable: true,
            });
            row.add_prefix(new Gtk.Image({ icon_name: 'folder-symbolic' }));
            const o = overrides[path] ?? {};
            const action = actions.find((a) => a.id === o.defaultAction);
            if (action) row.add_suffix(badge(action.name, 'accent'));
            if (o.hidden) row.add_suffix(badge('Hidden'));
            const remove = iconButton('user-trash-symbolic', 'Remove', ['circular']);
            remove.connect('clicked', () => removePinned(settings, path));
            row.add_suffix(remove);
            row.connect('activated', () => openProjectDialog(page, settings, path));
            return row;
        });
        rows.set(next.length > 0 ? next : [emptyRow('No pinned folders yet')]);
    };
    render();
    onSettingsChanged(page, settings, ['pinned', 'item-overrides', 'project-actions'], render);
    return group;
}

/** Folders hidden from the lists that are not pinned, with a way to show them again. */
function hiddenGroup(page, settings) {
    const home = GLib.get_home_dir();
    const group = new Adw.PreferencesGroup({
        title: 'Hidden folders',
        description: 'Folders you hid. They stay out of the menu and the popup.',
    });
    const rows = rowList(group);
    const render = () => {
        const pinned = new Set(pinnedPaths(settings));
        const overrides = readObject(settings, 'item-overrides');
        const hidden = Object.keys(overrides).filter((p) => overrides[p]?.hidden && !pinned.has(p));
        group.set_visible(hidden.length > 0);
        rows.set(
            hidden.map((path) => {
                const row = plainRow(baseName(path), shortenHome(path, home));
                row.add_prefix(new Gtk.Image({ icon_name: 'view-conceal-symbolic' }));
                const show = new Gtk.Button({ label: 'Show', valign: Gtk.Align.CENTER });
                show.connect('clicked', () => setOverride(settings, path, { hidden: false }));
                row.add_suffix(show);
                return row;
            }),
        );
    };
    render();
    onSettingsChanged(page, settings, ['pinned', 'item-overrides'], render);
    return group;
}

function rootsGroup(page, settings) {
    const home = GLib.get_home_dir();
    const group = new Adw.PreferencesGroup({
        title: 'Search roots',
        description: 'Folders to scan for git repositories (folders that contain a .git folder).',
    });
    const add = iconLabelButton('list-add-symbolic', 'Add root');
    add.connect('clicked', () =>
        chooseFolder(page, 'Add a search root', (path) => {
            const list = readList(settings, 'search-roots');
            const stored = shortenHome(path, home);
            if (list.includes(stored)) return;
            setJSON(settings, 'search-roots', [...list, stored]);
        }),
    );
    group.set_header_suffix(add);

    const rows = rowList(group);
    const renderRoots = () => {
        const next = readList(settings, 'search-roots').map((root) => {
            const label = root === '~' ? 'Home folder' : baseName(String(root));
            const row = plainRow(label, String(root));
            row.add_prefix(new Gtk.Image({ icon_name: 'folder-symbolic' }));
            const remove = iconButton('user-trash-symbolic', 'Remove', ['circular']);
            remove.connect('clicked', () =>
                setJSON(
                    settings,
                    'search-roots',
                    readList(settings, 'search-roots').filter((r) => r !== root),
                ),
            );
            row.add_suffix(remove);
            return row;
        });
        rows.set(
            next.length > 0 ? next : [emptyRow('No search roots. Only pinned folders are used.')],
        );
    };
    renderRoots();

    const depth = new Adw.SpinRow({
        title: 'Scan depth',
        subtitle:
            'Levels below each root. node_modules, .cache, vendor, target and similar folders are skipped.',
        use_markup: false,
        adjustment: new Gtk.Adjustment({
            lower: 1,
            upper: 10,
            step_increment: 1,
            page_increment: 1,
            value: settings.get_int('scan-depth'),
        }),
    });
    settings.bind('scan-depth', depth, 'value', Gio.SettingsBindFlags.DEFAULT);

    const skip = new Adw.EntryRow({
        title: 'Skipped folder names (comma separated)',
        text: formatNameList(readList(settings, 'skip-dirs').map(String)),
        show_apply_button: true,
    });
    skip.connect('apply', () => setJSON(settings, 'skip-dirs', parseNameList(skip.get_text())));

    const found = plainRow('Repositories found', 'Scanning...');
    found.add_prefix(new Gtk.Image({ icon_name: 'system-search-symbolic' }));

    // The scan runs in the background; changing a setting restarts it after a short pause.
    let cancellable = null;
    let timer = 0;
    const scan = () => {
        cancellable?.cancel();
        const mine = new Gio.Cancellable();
        cancellable = mine;
        found.set_subtitle('Scanning...');
        scanGit(settings, mine)
            .then((repos) => {
                if (mine.is_cancelled()) return;
                const limit = repos.length >= MAX_REPOS ? ' (limit reached)' : '';
                found.set_subtitle(
                    repos.length === 0 ? 'None found' : `${repos.length} found${limit}`,
                );
            })
            .catch(() => {
                if (!mine.is_cancelled()) found.set_subtitle('The scan failed');
            });
    };
    const schedule = () => {
        if (timer) GLib.source_remove(timer);
        timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            timer = 0;
            scan();
            return GLib.SOURCE_REMOVE;
        });
    };
    schedule();
    page.connect('unrealize', () => {
        cancellable?.cancel();
        if (timer) GLib.source_remove(timer);
        timer = 0;
    });
    onSettingsChanged(
        page,
        settings,
        ['search-roots', 'scan-depth', 'skip-dirs', 'include-worktrees'],
        schedule,
    );
    onSettingsChanged(page, settings, ['search-roots'], renderRoots);

    group.add(depth);
    group.add(skip);
    group.add(found);
    return group;
}

function recentGroup(page, settings) {
    const home = GLib.get_home_dir();
    const group = new Adw.PreferencesGroup({
        title: 'Recent from other tools',
        description:
            'Folders recently opened in these apps. Only apps found on this computer can be turned on.',
    });
    const sqliteOk = sqliteAvailable();
    const env = {
        findProgram,
        sqliteOk,
        dirExists: (rel) => GLib.file_test(`${home}/${rel}`, GLib.FileTest.IS_DIR),
    };
    const cancellable = new Gio.Cancellable();
    page.connect('unrealize', () => cancellable.cancel());

    for (const reader of RECENT_READERS) {
        if (!RECENT_SOURCE_INFO[reader.id]) continue;
        const { state, found } = recentSourceState(reader.id, env);
        const detail = found ? `Found at ${found}` : 'Reads the tool data in your home folder';
        const row = new Adw.SwitchRow({ title: reader.label, subtitle: detail, use_markup: false });
        const enabled = readObject(settings, 'recent-sources');
        if (state === 'not-installed') {
            row.set_subtitle('Offered when the app is installed');
            row.add_suffix(badge('Not installed'));
            row.set_active(false);
            row.set_sensitive(false);
        } else if (state === 'needs-sqlite') {
            row.set_subtitle('Install the sqlite3 command to read this list');
            row.add_suffix(badge('Needs sqlite3', 'warning'));
            row.set_active(false);
            row.set_sensitive(false);
        } else {
            row.set_active(enabled[reader.id] === true);
            row.connect('notify::active', () =>
                setJSON(settings, 'recent-sources', {
                    ...readObject(settings, 'recent-sources'),
                    [reader.id]: row.get_active(),
                }),
            );
            // How many folders the tool lists now, read in the background.
            reader
                .read({ cancellable })
                .then((entries) => {
                    if (cancellable.is_cancelled()) return;
                    row.set_subtitle(`${detail}. ${entries.length} recent folders.`);
                })
                .catch(() => {});
        }
        group.add(row);
    }
    return group;
}

export function buildProjectsPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Projects',
        icon_name: 'folder-symbolic',
    });
    page.add(pinnedGroup(page, settings));
    page.add(hiddenGroup(page, settings));
    page.add(rootsGroup(page, settings));
    page.add(recentGroup(page, settings));
    return page;
}
