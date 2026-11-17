import Adw from 'gi://Adw';

export function buildServersPage(_settings) {
    const page = new Adw.PreferencesPage({
        title: 'Servers',
        icon_name: 'network-server-symbolic',
    });
    page.add(new Adw.PreferencesGroup({ title: 'Servers' }));
    return page;
}
