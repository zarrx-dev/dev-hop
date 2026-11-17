import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Indicator } from './src/ui/indicator.js';

export default class DevHopExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settingsId = this._settings.connect('changed::show-indicator', () =>
            this._syncIndicator(),
        );
        this._syncIndicator();
    }

    disable() {
        if (this._settings && this._settingsId) {
            this._settings.disconnect(this._settingsId);
        }
        this._settingsId = null;
        this._destroyIndicator();
        this._settings = null;
    }

    _syncIndicator() {
        if (this._settings.get_boolean('show-indicator')) {
            if (!this._indicator) {
                this._indicator = new Indicator(() => this.openPreferences());
                Main.panel.addToStatusArea(this.uuid, this._indicator);
            }
        } else {
            this._destroyIndicator();
        }
    }

    _destroyIndicator() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
