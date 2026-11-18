// Small shell widgets shared by the menu, the popup and the action chooser.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

/**
 * Opacity (0-255) of dimmed text and icons. St CSS has no currentColor or opacity, so dimming
 * is done on the actor; it follows the theme colour on both light and dark shells.
 */
export const DIM_OPACITY = 170;

/**
 * The actor an event happened on, or null. `Clutter.Event.get_source()` can return null on
 * GNOME 46, so the stage lookup is preferred.
 */
export function eventActor(event) {
    try {
        if (typeof global !== 'undefined' && global.stage?.get_event_actor) {
            return global.stage.get_event_actor(event) ?? null;
        }
        return event.get_source?.() ?? null;
    } catch (_e) {
        return null;
    }
}

/** Icon kinds used by the rows, mapped to themed symbolic icons. */
const THEMED_ICONS = {
    pin: 'view-pin-symbolic',
    clock: 'document-open-recent-symbolic',
    server: 'network-server-symbolic',
    search: 'edit-find-symbolic',
    star: 'starred-symbolic',
    add: 'list-add-symbolic',
    settings: 'emblem-system-symbolic',
};

/**
 * An icon for a row kind (pin, clock, branch, server, ...) or a themed icon name. The branch
 * icon is shipped with the extension because the icon theme has none.
 * @param {string} kind
 * @param {string} iconDir folder with the shipped icons
 * @param {{styleClass?: string, size?: number}} [options]
 */
export function createIcon(kind, iconDir, { styleClass = 'dev-hop-row-icon', size = 16 } = {}) {
    const params = { style_class: styleClass, icon_size: size, y_align: Clutter.ActorAlign.CENTER };
    if (kind === 'branch') {
        params.gicon = Gio.icon_new_for_string(`${iconDir}/git-branch-symbolic.svg`);
    } else {
        params.icon_name = THEMED_ICONS[kind] ?? kind;
    }
    const icon = new St.Icon(params);
    icon.opacity = DIM_OPACITY;
    return icon;
}

/** A label that shows Pango markup. */
export function createMarkupLabel(markup, styleClass) {
    const label = new St.Label({ style_class: styleClass, y_align: Clutter.ActorAlign.CENTER });
    label.clutter_text.set_markup(markup);
    return label;
}

/** A small pill, such as the default action tag. */
export function createTag(text, styleClass = 'dev-hop-tag') {
    const tag = new St.Label({
        text,
        style_class: styleClass,
        y_align: Clutter.ActorAlign.CENTER,
        visible: text !== '',
    });
    if (styleClass === 'dev-hop-tag') tag.opacity = DIM_OPACITY;
    return tag;
}

/** A key cap, such as "Enter". */
export function createKey(text) {
    return new St.Label({
        text,
        style_class: 'dev-hop-key',
        y_align: Clutter.ActorAlign.CENTER,
    });
}

/** The header of a section: an upper case label and, when given, a count on the right. */
export function createSectionHeader(label, count = null) {
    const box = new St.BoxLayout({ style_class: 'dev-hop-section-header', x_expand: true });
    const title = new St.Label({
        text: label.toUpperCase(),
        style_class: 'dev-hop-section-title',
        x_expand: true,
    });
    title.opacity = DIM_OPACITY;
    box.add_child(title);
    if (count !== null) {
        const countLabel = new St.Label({
            text: String(count),
            style_class: 'dev-hop-section-count',
        });
        countLabel.opacity = DIM_OPACITY;
        box.add_child(countLabel);
    }
    return box;
}

/** A centred empty state: an icon, a title and a line of text. */
export function createEmptyState({ icon, title, text }, iconDir) {
    const box = new St.BoxLayout({
        style_class: 'dev-hop-empty',
        vertical: true,
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
    });
    const iconActor = createIcon(icon, iconDir, { styleClass: 'dev-hop-empty-icon', size: 32 });
    iconActor.x_align = Clutter.ActorAlign.CENTER;
    box.add_child(iconActor);
    const titleLabel = new St.Label({ text: title, style_class: 'dev-hop-empty-title' });
    titleLabel.x_align = Clutter.ActorAlign.CENTER;
    box.add_child(titleLabel);
    const textLabel = new St.Label({ text, style_class: 'dev-hop-empty-text' });
    textLabel.opacity = DIM_OPACITY;
    textLabel.clutter_text.line_wrap = true;
    textLabel.x_align = Clutter.ActorAlign.CENTER;
    box.add_child(textLabel);
    return box;
}

const SUBTITLE_SEPARATOR = '  -  ';

/**
 * The dim line under a name. A "path  -  source" subtitle becomes two labels: the path can
 * shrink and loses its start ("...orkspace/app"), the source part stays whole.
 */
function createSubtitle(subtitle) {
    const box = new St.BoxLayout({ style_class: 'dev-hop-row-subline', x_expand: true });
    box.opacity = DIM_OPACITY;
    const at = subtitle.indexOf(SUBTITLE_SEPARATOR);
    const pathText = at === -1 ? subtitle : subtitle.slice(0, at);
    const path = new St.Label({ text: pathText, style_class: 'dev-hop-row-subtitle' });
    // Long paths lose their start, so the folder name at the end stays visible.
    path.clutter_text.ellipsize = Pango.EllipsizeMode.START;
    box.add_child(path);
    if (at !== -1) {
        // The dash and the source are separate labels; the box spacing is the only gap.
        for (const text of ['-', subtitle.slice(at + SUBTITLE_SEPARATOR.length).trim()]) {
            const part = new St.Label({ text, style_class: 'dev-hop-row-subtitle' });
            part.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            box.add_child(part);
        }
    }
    return box;
}

/**
 * Add the common row content to a box: icon, name over subtitle, and the default action tag.
 * @param {St.BoxLayout} box
 * @param {{icon: string, nameMarkup: string, subtitle: string}} row from model.buildSections
 * @param {string} tagText
 * @param {string} iconDir
 * @returns {{tag: St.Label}}
 */
export function appendRowBody(box, row, tagText, iconDir) {
    box.add_child(createIcon(row.icon, iconDir));
    const text = new St.BoxLayout({
        style_class: 'dev-hop-row-text',
        vertical: true,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    text.add_child(createMarkupLabel(row.nameMarkup, 'dev-hop-row-title'));
    text.add_child(createSubtitle(row.subtitle));
    box.add_child(text);
    const tag = createTag(tagText);
    box.add_child(tag);
    return { tag };
}
