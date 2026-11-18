// Row widgets for the top bar menu.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { appendRowBody, DIM_OPACITY } from './widgets.js';

/**
 * A project or server row: icon, name, dim subtitle, default action tag and an expander that
 * emits `toggle-actions`. Activating the row (click or Enter) is the default action; connect
 * to `activate` for it.
 */
export const MenuRow = GObject.registerClass(
    {
        Signals: { 'toggle-actions': {} },
    },
    class DevHopMenuRow extends PopupMenu.PopupBaseMenuItem {
        _init(row, tagText, iconDir) {
            super._init({ style_class: 'dev-hop-row' });
            this._expanded = false;
            appendRowBody(this, row, tagText, iconDir);

            this._expanderIcon = new St.Icon({
                icon_name: 'pan-down-symbolic',
                icon_size: 16,
            });
            this._expander = new St.Button({
                style_class: 'dev-hop-expander',
                can_focus: true,
                child: this._expanderIcon,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._expander.opacity = DIM_OPACITY;
            const syncExpanderOpacity = () => {
                const lit = this._expander.hover || this._expander.has_key_focus();
                this._expander.opacity = lit ? 255 : DIM_OPACITY;
            };
            this._expander.connect('notify::hover', syncExpanderOpacity);
            this._expander.connect('key-focus-in', syncExpanderOpacity);
            this._expander.connect('key-focus-out', syncExpanderOpacity);
            this._expander.connect('clicked', () => this.emit('toggle-actions'));
            this.add_child(this._expander);
        }

        setExpanded(expanded) {
            this._expanded = expanded;
            this._expanderIcon.icon_name = expanded ? 'pan-up-symbolic' : 'pan-down-symbolic';
            if (expanded) this.add_style_class_name('dev-hop-row-open');
            else this.remove_style_class_name('dev-hop-row-open');
        }

        vfunc_key_press_event(event) {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Right && !this._expanded) {
                this.emit('toggle-actions');
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Left && this._expanded) {
                this.emit('toggle-actions');
                return Clutter.EVENT_STOP;
            }
            return super.vfunc_key_press_event(event);
        }
    },
);

/** A menu item that only holds an actor (a section header or an empty state). */
export function createStaticItem(child, styleClass) {
    const item = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
        style_class: styleClass,
    });
    item.add_child(child);
    return item;
}
