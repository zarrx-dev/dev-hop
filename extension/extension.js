import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { availableActions, run } from './src/actions/runner.js';
import { findProgram } from './src/core/programs.js';
import { getJSON } from './src/settings.js';
import { SourceManager } from './src/sources/manager.js';
import { Indicator } from './src/ui/indicator.js';
import { SearchPopup } from './src/ui/searchPopup.js';

const TOGGLE_KEY = 'toggle-popup';

export default class DevHopExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._manager = new SourceManager(this._settings);

        // Looking up a program is a stat of every PATH folder, so remember the answers until the
        // next time the menu or the popup opens.
        const programs = new Map();
        this._findProgram = (binary) => {
            if (!programs.has(binary)) programs.set(binary, findProgram(binary));
            return programs.get(binary);
        };
        this._deps = {
            manager: this._manager,
            iconDir: `${this.path}/icons`,
            actionsFor: (kind, item) =>
                availableActions(this._settings, kind, item, this._findProgram),
            runAction: (kind, item, action) => this._runAction(kind, item, action),
            openPrefs: () => this.openPreferences(),
            setDefault: (kind, item, actionId) => this._setDefault(kind, item, actionId),
            beginSession: () => programs.clear(),
        };

        this._popup = new SearchPopup(this._deps);
        Main.wm.addKeybinding(
            TOGGLE_KEY,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._popup.toggle(),
        );

        this._settingsId = this._settings.connect('changed::show-indicator', () =>
            this._syncIndicator(),
        );
        this._syncIndicator();

        // Warm the lists so the first open is not empty.
        this._manager.refresh().catch((e) => {
            console.warn(`dev-hop: refresh failed: ${e.message}`);
        });
    }

    disable() {
        Main.wm.removeKeybinding(TOGGLE_KEY);
        if (this._settings && this._settingsId) {
            this._settings.disconnect(this._settingsId);
        }
        this._settingsId = null;
        this._popup?.destroy();
        this._popup = null;
        this._destroyIndicator();
        this._manager?.destroy();
        this._manager = null;
        this._deps = null;
        this._findProgram = null;
        this._settings = null;
    }

    _runAction(kind, item, action) {
        if (!action) {
            Main.notify('dev-hop', 'No action is available for this item.');
            return;
        }
        const result = run(this._settings, kind, item, action, this._findProgram);
        if (!result.ok) Main.notify('dev-hop', result.error);
    }

    /**
     * Store the default action of one project (item-overrides, keyed by path) or one server
     * (server-meta, keyed by host). The manager rebuilds its lists synchronously on the change.
     */
    _setDefault(kind, item, actionId) {
        const key = kind === 'server' ? 'server-meta' : 'item-overrides';
        const id = kind === 'server' ? item.host : item.path;
        const map = getJSON(this._settings, key, '{}') ?? {};
        map[id] = { ...(map[id] ?? {}), defaultAction: actionId };
        this._settings.set_string(key, JSON.stringify(map));
    }

    _syncIndicator() {
        if (this._settings.get_boolean('show-indicator')) {
            if (!this._indicator) {
                this._indicator = new Indicator(this._deps);
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
