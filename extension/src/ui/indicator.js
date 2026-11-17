import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export const Indicator = GObject.registerClass(
    class DevHopIndicator extends PanelMenu.Button {
        _init(openSettings) {
            super._init(0.5, 'dev-hop', false);

            this.add_child(
                new St.Icon({
                    icon_name: 'utilities-terminal-symbolic',
                    style_class: 'system-status-icon',
                }),
            );

            const placeholder = new PopupMenu.PopupMenuItem('dev-hop', { reactive: false });
            placeholder.setSensitive(false);
            this.menu.addMenuItem(placeholder);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const settingsItem = new PopupMenu.PopupMenuItem('Settings');
            settingsItem.connect('activate', () => openSettings());
            this.menu.addMenuItem(settingsItem);
        }
    },
);
