import Adw from 'gi://Adw';

export function buildProjectsPage(_settings) {
    const page = new Adw.PreferencesPage({
        title: 'Projects',
        icon_name: 'folder-symbolic',
    });
    page.add(new Adw.PreferencesGroup({ title: 'Projects' }));
    return page;
}
