import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { buildActionsPage } from './src/prefs/actionsPage.js';
import { buildGeneralPage } from './src/prefs/generalPage.js';
import { buildProjectsPage } from './src/prefs/projectsPage.js';
import { buildServersPage } from './src/prefs/serversPage.js';

export default class DevHopPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(860, 700);
        window.add(buildProjectsPage(settings));
        window.add(buildServersPage(settings));
        window.add(buildActionsPage(settings));
        window.add(buildGeneralPage(settings));
    }
}
