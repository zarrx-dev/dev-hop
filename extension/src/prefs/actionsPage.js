import Adw from 'gi://Adw';

export function buildActionsPage(_settings) {
    const page = new Adw.PreferencesPage({
        title: 'Actions',
        icon_name: 'system-run-symbolic',
    });
    page.add(new Adw.PreferencesGroup({ title: 'Actions' }));
    return page;
}
