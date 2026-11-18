// The Super+J launcher: a modal search box with grouped results and an action chooser.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { ActionChooser } from './actionChooser.js';
import { buildSections, DEFAULT_LIMIT, EMPTY_COPY, footerHints } from './model.js';
import {
    appendRowBody,
    createEmptyState,
    createIcon,
    createKey,
    createSectionHeader,
    DIM_OPACITY,
    eventActor,
} from './widgets.js';

const POPUP_WIDTH = 640;
const SCREEN_MARGIN = 16;
const LIST_MAX_HEIGHT = 440;
/** Search bar (58) + footer (about 50) + borders. */
const CHROME_HEIGHT = 112;

const RETURN_KEYS = [Clutter.KEY_Return, Clutter.KEY_KP_Enter, Clutter.KEY_ISO_Enter];

/** The vertical adjustment of a scroll view: `vadjustment` on GNOME 46+, `vscroll` on 45. */
function verticalAdjustment(scrollView) {
    return scrollView.vadjustment ?? scrollView.vscroll?.adjustment ?? null;
}

/**
 * The search popup. Nothing is created until `open()`; `close()` destroys it all again.
 *
 * `deps`: {manager, actionsFor(kind, item), runAction(kind, item, action|null), openPrefs(),
 * beginSession(), iconDir}.
 */
export class SearchPopup {
    constructor(deps) {
        this._deps = deps;
        this._root = null;
        this._grab = null;
    }

    get isOpen() {
        return this._root !== null;
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    open() {
        if (this._root) return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        this._deps.beginSession();
        this._home = GLib.get_home_dir();
        this._query = '';
        this._selected = 0;
        this._entries = [];
        this._chooser = null;
        this._dirty = false;
        this._buildActors();
        this._layout();
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._layout());

        Main.layoutManager.modalDialogGroup.add_child(this._root);
        this._grab = Main.pushModal(this._root);
        if (!this._grab) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = null;
            this._root.destroy();
            this._root = null;
            return;
        }
        this._entry.grab_key_focus();
        this._render({ reset: true });

        this._changedId = this._deps.manager.connect('changed', () => {
            if (this._chooser) this._dirty = true;
            else this._render();
        });
        this._sessionId = Main.sessionMode.connect('updated', () => this.close());
        this._deps.manager.refresh().catch((e) => {
            console.warn(`dev-hop: refresh failed: ${e.message}`);
        });
    }

    close() {
        if (!this._root) return;
        if (this._changedId) this._deps.manager.disconnect(this._changedId);
        this._changedId = null;
        if (this._sessionId) Main.sessionMode.disconnect(this._sessionId);
        this._sessionId = null;
        if (this._monitorsId) Main.layoutManager.disconnect(this._monitorsId);
        this._monitorsId = null;
        if (this._scrollIdle) GLib.source_remove(this._scrollIdle);
        this._scrollIdle = null;
        this._chooser?.destroy();
        this._chooser = null;
        if (this._grab) Main.popModal(this._grab);
        this._grab = null;
        this._root.destroy();
        this._root = null;
        this._entries = [];
    }

    destroy() {
        this.close();
    }

    /**
     * Size and place the popup from the primary monitor's work area: centred horizontally, top
     * edge fixed at 15% of the work-area height, height capped so it always fits. Independent
     * of the result count, so the popup does not move as results change.
     */
    _layout() {
        if (!this._root) return;
        const lm = Main.layoutManager;
        const monitor = lm.primaryMonitor;
        if (!monitor) return;
        const area = lm.getWorkAreaForMonitor(lm.primaryIndex);
        this._root.set_position(monitor.x, monitor.y);
        this._root.set_size(monitor.width, monitor.height);

        const top = Math.round(area.height * 0.15);
        const width = Math.min(POPUP_WIDTH, area.width - 2 * SCREEN_MARGIN);
        this._card.set_width(width);
        // Explicit position inside the root (a plain widget with no layout manager): the theme's
        // `popup-menu-content` margins and a BinLayout cannot move it.
        this._card.set_position(
            Math.round(area.x - monitor.x + (area.width - width) / 2),
            Math.round(area.y - monitor.y + top),
        );

        // Search bar, footer and borders take a fixed share; the list gets the rest and scrolls.
        const available = area.height - top - SCREEN_MARGIN - CHROME_HEIGHT;
        const listMax = Math.max(120, Math.min(LIST_MAX_HEIGHT, available));
        this._scroll.set_style(`max-height: ${listMax}px;`);
    }

    _buildActors() {
        this._root = new St.Widget({
            style_class: 'dev-hop-backdrop',
            reactive: true,
        });
        this._root.connect('captured-event', (_actor, event) => {
            try {
                return this._onCaptured(event);
            } catch (e) {
                console.warn(`dev-hop: event handler failed: ${e.message}`);
                return Clutter.EVENT_PROPAGATE;
            }
        });
        this._root.connect('button-press-event', (_actor, event) => {
            if (eventActor(event) === this._root) this.close();
            return Clutter.EVENT_STOP;
        });

        const card = new St.BoxLayout({
            style_class: 'popup-menu-content dev-hop-popup',
            vertical: true,
            reactive: true,
        });
        this._card = card;
        this._root.add_child(card);

        const bar = new St.BoxLayout({ style_class: 'dev-hop-popup-bar' });
        bar.add_child(createIcon('search', this._deps.iconDir, { size: 20 }));
        this._entry = new St.Entry({
            style_class: 'dev-hop-popup-entry',
            hint_text: 'Search projects and servers',
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._entry.clutter_text.connect('text-changed', () => {
            const text = this._entry.get_text();
            if (text === this._query) return;
            this._query = text;
            this._render({ reset: true });
        });
        bar.add_child(this._entry);
        card.add_child(bar);

        this._body = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        this._scroll = new St.ScrollView({
            style_class: 'dev-hop-popup-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            // Not overlaid: the scrollbar takes its own space, so it never covers the rows.
            overlay_scrollbars: false,
            x_expand: true,
        });
        this._list = new St.BoxLayout({ style_class: 'dev-hop-popup-list', vertical: true });
        this._scroll.add_child(this._list);
        this._body.add_child(this._scroll);
        card.add_child(this._body);

        this._foot = new St.BoxLayout({ style_class: 'dev-hop-popup-foot' });
        card.add_child(this._foot);
    }

    // --- rendering ---------------------------------------------------------------------

    _render({ reset = false } = {}) {
        const { manager, actionsFor, iconDir } = this._deps;
        this._list.destroy_all_children();
        this._entries = [];

        const model = buildSections({
            projects: manager.getProjects(),
            servers: manager.getServers(),
            query: this._query,
            mode: 'popup',
            home: this._home,
            limit: DEFAULT_LIMIT,
        });
        this._model = model;
        const searching = model.query !== '';

        if (model.total === 0) {
            if (searching) {
                this._list.add_child(
                    createEmptyState(
                        { icon: 'search', ...EMPTY_COPY.noMatches(model.query) },
                        iconDir,
                    ),
                );
            } else {
                this._list.add_child(
                    createEmptyState(
                        { icon: 'folder-symbolic', ...EMPTY_COPY.noProjects },
                        iconDir,
                    ),
                );
            }
        }

        for (const section of model.sections) {
            const header = createSectionHeader(section.label, searching ? section.count : null);
            this._list.add_child(header);
            section.rows.forEach((row, i) => {
                const index = this._entries.length;
                const actions = actionsFor(row.kind, row.item);
                const defaultAction = actions.find((a) => a.isDefault) ?? null;
                const entry = this._buildRow(index, row, defaultAction);
                entry.row = row;
                entry.actions = actions;
                entry.defaultAction = defaultAction;
                entry.lead = i === 0 ? header : entry.button;
                this._entries.push(entry);
                this._list.add_child(entry.button);
            });
        }

        this._selected = reset
            ? 0
            : Math.min(this._selected, Math.max(this._entries.length - 1, 0));
        this._select(this._selected, { scroll: !reset });
        if (reset) verticalAdjustment(this._scroll)?.set_value(0);
    }

    _buildRow(index, row, defaultAction) {
        const button = new St.Button({
            style_class: 'dev-hop-result-row',
            reactive: true,
            can_focus: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });
        const body = new St.BoxLayout({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        appendRowBody(body, row, defaultAction?.name ?? '', this._deps.iconDir);
        const key = createKey('Enter');
        key.hide();
        body.add_child(key);
        button.set_child(body);
        button.connect('motion-event', () => {
            if (this._selected !== index && !this._chooser) this._select(index, { scroll: false });
            return Clutter.EVENT_PROPAGATE;
        });
        button.connect('clicked', () => {
            if (this._chooser) return;
            this._select(index, { scroll: false });
            this._runSelected();
        });
        return { button, key };
    }

    _select(index, { scroll = true } = {}) {
        const previous = this._entries[this._selected];
        previous?.button.remove_style_class_name('dev-hop-selected');
        previous?.key.hide();
        this._selected = index;
        const entry = this._entries[index];
        if (entry) {
            entry.button.add_style_class_name('dev-hop-selected');
            entry.key.show();
            if (scroll) this._scrollTo(index);
        }
        this._renderFooter();
    }

    /**
     * Bring a row fully into view, with its section header when it is the first of its
     * section. Rows and headers are direct children of the list, so their y is relative to the
     * scrolled content. Allocations can be stale right after a render, so it runs once now and
     * once more when idle. No animation.
     */
    _scrollTo(index) {
        this._applyScroll(index);
        if (this._scrollIdle) GLib.source_remove(this._scrollIdle);
        this._scrollIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._scrollIdle = null;
            if (this._root) this._applyScroll(index);
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyScroll(index) {
        const entry = this._entries[index];
        const adj = verticalAdjustment(this._scroll);
        if (!entry || !adj) return;
        if (index === 0) {
            adj.set_value(0);
            return;
        }
        if (index === this._entries.length - 1) {
            adj.set_value(adj.upper);
            return;
        }
        const top = entry.lead.get_y();
        const bottom = entry.button.get_y() + entry.button.get_height();
        if (top < adj.value) adj.set_value(top);
        else if (bottom > adj.value + adj.page_size) adj.set_value(bottom - adj.page_size);
    }

    _renderFooter() {
        this._foot.destroy_all_children();
        let hints;
        if (this._chooser) hints = footerHints({ state: 'chooser' });
        else if (this._entries.length === 0) hints = footerHints({ state: 'empty' });
        else {
            hints = footerHints({
                state: 'results',
                actionName: this._entries[this._selected]?.defaultAction?.name ?? '',
            });
        }
        for (const hint of hints) {
            const item = new St.BoxLayout({ style_class: 'dev-hop-hint' });
            item.add_child(createKey(hint.key));
            const hintLabel = new St.Label({
                text: hint.text,
                style_class: 'dev-hop-hint-text',
                y_align: Clutter.ActorAlign.CENTER,
            });
            hintLabel.opacity = DIM_OPACITY;
            item.add_child(hintLabel);
            this._foot.add_child(item);
        }
    }

    // --- keys and actions --------------------------------------------------------------

    _onCaptured(event) {
        if (event.type() === Clutter.EventType.BUTTON_PRESS) {
            // A click anywhere outside the popup box (on the backdrop) closes the popup. The
            // chooser lives inside the box, so its own scrim handles clicks outside it.
            const actor = eventActor(event);
            if (!actor || !this._card.contains(actor)) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }
        if (event.type() !== Clutter.EventType.KEY_PRESS) return Clutter.EVENT_PROPAGATE;
        const symbol = event.get_key_symbol();
        const state = event.get_state();
        const shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
        const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;

        if (this._chooser) {
            if (symbol === Clutter.KEY_Escape) this._closeChooser();
            else if (symbol === Clutter.KEY_Up) this._chooser.move(-1);
            else if (symbol === Clutter.KEY_Down) this._chooser.move(1);
            else if (RETURN_KEYS.includes(symbol)) this._chooser.activate();
            return Clutter.EVENT_STOP;
        }

        if (symbol === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Up || symbol === Clutter.KEY_Down) {
            this._move(symbol === Clutter.KEY_Up ? -1 : 1);
            return Clutter.EVENT_STOP;
        }
        if (RETURN_KEYS.includes(symbol)) {
            if (shift) this._openChooser();
            else this._runSelected();
            return Clutter.EVENT_STOP;
        }
        if (ctrl && symbol === Clutter.KEY_BackSpace) {
            this._entry.set_text('');
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _move(delta) {
        const count = this._entries.length;
        if (count === 0) return;
        this._select((this._selected + delta + count) % count);
    }

    _runSelected() {
        const entry = this._entries[this._selected];
        if (!entry) return;
        this.close();
        this._deps.runAction(entry.row.kind, entry.row.item, entry.defaultAction);
    }

    _openChooser({ picking = false } = {}) {
        const entry = this._entries[this._selected];
        if (!entry) return;
        const { runAction, setDefault, iconDir } = this._deps;
        this._chooser = new ActionChooser({
            title: picking
                ? `Choose the default for ${entry.row.name}`
                : `Actions for ${entry.row.name}`,
            kind: entry.row.kind,
            actions: entry.actions,
            iconDir,
            picking,
            onRun: (action) => {
                if (picking) {
                    // Store it, then come back to the chooser with the badge moved.
                    setDefault(entry.row.kind, entry.row.item, action.id);
                    this._closeChooser();
                    this._openChooser();
                    return;
                }
                this.close();
                runAction(entry.row.kind, entry.row.item, action);
            },
            onSetDefault: () => {
                this._closeChooser();
                this._openChooser({ picking: true });
            },
        });
        this._scrim = new St.Widget({
            style_class: 'dev-hop-chooser-scrim',
            reactive: true,
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this._scrim.connect('button-press-event', (_actor, event) => {
            if (eventActor(event) === this._scrim) this._closeChooser();
            return Clutter.EVENT_STOP;
        });
        this._scrim.add_child(this._chooser.actor);
        this._body.add_child(this._scrim);
        this._renderFooter();
    }

    _closeChooser() {
        this._chooser?.destroy();
        this._chooser = null;
        this._scrim?.destroy();
        this._scrim = null;
        this._entry.grab_key_focus();
        if (this._dirty) {
            this._dirty = false;
            this._render();
        } else {
            this._renderFooter();
        }
    }
}
