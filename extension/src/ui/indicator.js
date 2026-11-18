import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as ShellUtil from 'resource:///org/gnome/shell/misc/util.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { createStaticItem, MenuRow } from './menuRows.js';
import { buildSections, EMPTY_COPY, shortActionName } from './model.js';
import { createEmptyState, createSectionHeader, DIM_OPACITY } from './widgets.js';

/** Rows shown while a search query is typed, at most. */
const MENU_RESULT_LIMIT = 30;

function ensureVisible(scrollView, actor) {
    try {
        ShellUtil.ensureActorVisibleInScrollView?.(scrollView, actor);
    } catch (_e) {
        // The actor is not in the scroll view (yet). Nothing to scroll.
    }
}

/**
 * The top bar button and its menu: a search entry, a scrolling list of Pinned, Recent projects
 * and Servers, and Settings. Clicking a row runs its default action; its expander lists the
 * other actions.
 *
 * `deps`: {manager, actionsFor(kind, item), runAction(kind, item, action|null), openPrefs(),
 * beginSession(), iconDir}.
 */
export const Indicator = GObject.registerClass(
    class DevHopIndicator extends PanelMenu.Button {
        _init(deps) {
            super._init(0.5, 'dev-hop', false);
            this._deps = deps;
            this._home = GLib.get_home_dir();
            this._query = '';
            this._entries = [];

            this.add_child(
                new St.Icon({
                    icon_name: 'utilities-terminal-symbolic',
                    style_class: 'system-status-icon',
                }),
            );
            this.menu.box.add_style_class_name('dev-hop-menu');

            this._buildMenu();

            this._changedId = deps.manager.connect('changed', () => {
                if (this.menu.isOpen) this._render();
            });
            this.menu.connect('open-state-changed', (_menu, open) => {
                if (open) this._onOpened();
            });
            this.connect('destroy', () => {
                deps.manager.disconnect(this._changedId);
                this._changedId = null;
            });
        }

        _buildMenu() {
            this._entry = new St.Entry({
                style_class: 'dev-hop-search-entry',
                hint_text: 'Search projects and servers',
                can_focus: true,
                x_expand: true,
            });
            const searchIcon = new St.Icon({
                icon_name: 'edit-find-symbolic',
                style_class: 'dev-hop-search-icon',
            });
            searchIcon.opacity = DIM_OPACITY;
            this._entry.set_primary_icon(searchIcon);
            this._entry.clutter_text.connect('text-changed', () => {
                const text = this._entry.get_text();
                if (text === this._query) return;
                this._query = text;
                this._render();
            });
            this._entry.clutter_text.connect('activate', () => this._activateFirst());
            const searchItem = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
                style_class: 'dev-hop-search-item',
            });
            searchItem.add_child(this._entry);
            this.menu.addMenuItem(searchItem);

            this._list = new PopupMenu.PopupMenuSection();
            this._scroll = new St.ScrollView({
                style_class: 'dev-hop-scroll',
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                overlay_scrollbars: true,
            });
            this._scroll.add_child(this._list.actor);
            const scrollSection = new PopupMenu.PopupMenuSection();
            scrollSection.actor.add_child(this._scroll);
            this.menu.addMenuItem(scrollSection);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const settings = new PopupMenu.PopupImageMenuItem('Settings', 'emblem-system-symbolic');
            settings.connect('activate', () => this._deps.openPrefs());
            this.menu.addMenuItem(settings);
        }

        _onOpened() {
            this._deps.beginSession();
            this._openKey = null;
            this._query = '';
            this._entry.set_text('');
            this._render();
            this._deps.manager.refresh().catch((e) => {
                console.warn(`dev-hop: refresh failed: ${e.message}`);
            });
            this._entry.grab_key_focus();
        }

        _render() {
            const { manager, iconDir } = this._deps;
            this._list.removeAll();
            this._list.actor.destroy_all_children();
            this._entries = [];

            const projects = manager.getProjects();
            const model = buildSections({
                projects,
                servers: manager.getServers(),
                query: this._query,
                mode: 'menu',
                home: this._home,
                limit: MENU_RESULT_LIMIT,
            });
            const addHeader = (label, count) =>
                this._list.addMenuItem(
                    createStaticItem(createSectionHeader(label, count), 'dev-hop-header-item'),
                );
            const addEmpty = (icon, copy) =>
                this._list.addMenuItem(
                    createStaticItem(
                        createEmptyState({ icon, ...copy }, iconDir),
                        'dev-hop-empty-item',
                    ),
                );
            const addSection = (section) => {
                addHeader(section.label, section.count);
                for (const row of section.rows) this._addRow(row);
            };

            if (this._query.trim() !== '') {
                if (model.total === 0) addEmpty('search', EMPTY_COPY.noMatches(model.query));
                for (const section of model.sections) addSection(section);
                return;
            }

            const projectSections = model.sections.filter((s) => s.id !== 'servers');
            for (const section of projectSections) addSection(section);
            if (projectSections.length === 0) {
                addHeader('Projects', null);
                addEmpty(
                    'folder-symbolic',
                    projects.length > 0 ? EMPTY_COPY.noPinnedOrRecent : EMPTY_COPY.noProjects,
                );
                const pin = new PopupMenu.PopupImageMenuItem(
                    'Pin a folder...',
                    'list-add-symbolic',
                );
                pin.connect('activate', () => this._deps.openPrefs());
                this._list.addMenuItem(pin);
            }
            const servers = model.sections.find((s) => s.id === 'servers');
            if (servers) {
                addSection(servers);
            } else {
                addHeader('Servers', null);
                addEmpty('server', EMPTY_COPY.noServers);
            }
        }

        _addRow(row) {
            const { actionsFor, runAction, iconDir } = this._deps;
            const actions = actionsFor(row.kind, row.item);
            const defaultAction = actions.find((a) => a.isDefault) ?? null;
            const item = new MenuRow(
                row,
                defaultAction ? shortActionName(defaultAction.name) : '',
                iconDir,
            );
            item.connect('activate', () => runAction(row.kind, row.item, defaultAction));
            item.connect('key-focus-in', () => ensureVisible(this._scroll, item));

            const submenu = new PopupMenu.PopupMenuSection();
            submenu.actor.add_style_class_name('dev-hop-submenu');
            submenu.actor.hide();
            let filled = false;
            const key = `${row.kind}:${row.item.path ?? row.item.host}`;
            const setOpen = (open) => {
                if (open && !filled) {
                    filled = true;
                    this._fillActions(submenu, row, actions, false);
                }
                submenu.actor.visible = open;
                item.setExpanded(open);
                this._openKey = open ? key : null;
                if (open) ensureVisible(this._scroll, submenu.actor);
            };
            item.connect('toggle-actions', () => setOpen(!submenu.actor.visible));

            this._list.addMenuItem(item);
            this._list.addMenuItem(submenu);
            this._entries.push({ row, defaultAction });
            // A re-render (after a default changed) keeps the open submenu open.
            if (this._openKey === key) setOpen(true);
        }

        /**
         * Fill the actions submenu. With `picking`, activating an action stores it as the new
         * default (the manager then re-renders the menu, which keeps this submenu open).
         */
        _fillActions(submenu, row, actions, picking) {
            const { runAction, setDefault } = this._deps;
            submenu.removeAll();
            submenu.actor.destroy_all_children();
            for (const action of actions) {
                const item = new PopupMenu.PopupImageMenuItem(
                    action.name,
                    action.icon || 'system-run-symbolic',
                );
                item.setOrnament(
                    action.isDefault ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE,
                );
                if (picking) {
                    // Overriding activate keeps the menu open: nothing is emitted to close it.
                    item.activate = () => setDefault(row.kind, row.item, action.id);
                } else {
                    item.connect('activate', () => runAction(row.kind, row.item, action));
                }
                submenu.addMenuItem(item);
            }
            // A plain thin line: PopupSeparatorMenuItem brings its own row height.
            if (actions.length > 0) {
                submenu.actor.add_child(
                    new St.Widget({ style_class: 'dev-hop-separator dev-hop-submenu-separator' }),
                );
            }
            const what = row.kind === 'project' ? 'project' : 'server';
            const label = picking
                ? 'Pick the new default above (cancel)'
                : `Set default action for this ${what}...`;
            const toggle = new PopupMenu.PopupImageMenuItem(label, 'starred-symbolic');
            // Same ornament state as the action items, so all icons line up.
            toggle.setOrnament(PopupMenu.Ornament.NONE);
            // Switches between "run" and "pick the default" in place; the menu stays open.
            toggle.activate = () => this._fillActions(submenu, row, actions, !picking);
            submenu.addMenuItem(toggle);
        }

        _activateFirst() {
            const first = this._entries[0];
            if (!first) return Clutter.EVENT_STOP;
            this.menu.close();
            this._deps.runAction(first.row.kind, first.row.item, first.defaultAction);
            return Clutter.EVENT_STOP;
        }
    },
);
