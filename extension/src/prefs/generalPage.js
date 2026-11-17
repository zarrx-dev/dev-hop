import Adw from 'gi://Adw';

export function buildGeneralPage(_settings) {
    const page = new Adw.PreferencesPage({
        title: 'General',
        icon_name: 'preferences-system-symbolic',
    });
    page.add(new Adw.PreferencesGroup({ title: 'General' }));
    return page;
}
