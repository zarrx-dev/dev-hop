// The action chooser: a small panel over the search popup that lists every action of one item.
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import { createIcon, createTag, DIM_OPACITY } from './widgets.js';

/**
 * The actions of one item, the default one marked, then "Set default ...". The popup forwards
 * the keys: `move(delta)` and `activate()`. Mouse hover selects and a click activates.
 */
export class ActionChooser {
    /**
     * @param {{title: string, kind: 'project'|'server', actions: object[], iconDir: string,
     *   onRun: (action: object) => void, onSetDefault: () => void, picking?: boolean}} options
     *   `picking`: the rows choose a new default (no "set default" row); the caller handles it
     *   in `onRun`.
     */
    constructor({ title, kind, actions, iconDir, onRun, onSetDefault, picking = false }) {
        this._entries = [];
        this._selected = 0;

        this.actor = new St.BoxLayout({
            style_class: 'popup-menu-content dev-hop-chooser',
            vertical: true,
            reactive: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
        });
        const head = new St.Label({ text: title, style_class: 'dev-hop-chooser-head' });
        head.opacity = DIM_OPACITY;
        this.actor.add_child(head);

        for (const action of actions) {
            this._addRow({
                icon: action.icon || 'system-run-symbolic',
                label: action.name,
                badge: action.isDefault,
                iconDir,
                run: () => onRun(action),
            });
        }
        if (!picking) {
            if (actions.length > 0) {
                this.actor.add_child(new St.Widget({ style_class: 'dev-hop-separator' }));
            }
            this._addRow({
                icon: 'star',
                label:
                    kind === 'project'
                        ? 'Set default for this project...'
                        : 'Set default for this server...',
                badge: false,
                iconDir,
                run: () => onSetDefault(),
            });
        }

        const first = actions.findIndex((a) => a.isDefault);
        this._select(first >= 0 ? first : 0);
    }

    _addRow({ icon, label, badge, iconDir, run }) {
        const index = this._entries.length;
        const button = new St.Button({
            style_class: 'dev-hop-chooser-row',
            reactive: true,
            can_focus: false,
            x_expand: true,
        });
        const body = new St.BoxLayout({ x_expand: true });
        body.add_child(createIcon(icon, iconDir));
        body.add_child(
            new St.Label({
                text: label,
                style_class: 'dev-hop-chooser-label',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            }),
        );
        if (badge) body.add_child(createTag('default', 'dev-hop-default-badge'));
        button.set_child(body);
        button.connect('motion-event', () => {
            if (this._selected !== index) this._select(index);
            return Clutter.EVENT_PROPAGATE;
        });
        button.connect('clicked', () => {
            this._select(index);
            this.activate();
        });
        this.actor.add_child(button);
        this._entries.push({ button, run });
    }

    _select(index) {
        this._entries[this._selected]?.button.remove_style_class_name('dev-hop-selected');
        this._selected = index;
        this._entries[index]?.button.add_style_class_name('dev-hop-selected');
    }

    move(delta) {
        const count = this._entries.length;
        if (count === 0) return;
        this._select((this._selected + delta + count) % count);
    }

    activate() {
        this._entries[this._selected]?.run();
    }

    destroy() {
        this._entries = [];
        this.actor.destroy();
    }
}
