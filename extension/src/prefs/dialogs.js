// Every dialog of the preferences window goes through this module. libadwaita 1.5 (GNOME 46)
// added Adw.Dialog and Adw.AlertDialog; on GNOME 45 they do not exist, so the same content is
// shown in a modal, transient Adw.Window and confirmations use Adw.MessageDialog.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

/** @returns {boolean} true when libadwaita has Adw.Dialog (1.5 and newer) */
export function hasAdwDialog() {
    return typeof Adw.Dialog === 'function';
}

function hasAlertDialog() {
    return typeof Adw.AlertDialog === 'function';
}

function rootWindow(widget) {
    return widget.get_root();
}

/**
 * Show a dialog with a header (Cancel, title, confirm button) around `content`.
 * @param {Gtk.Widget} parent any widget that is inside the preferences window
 * @param {{title: string, content: Gtk.Widget, confirmLabel?: string, cancelLabel?: string|null,
 *   width?: number, height?: number,
 *   onConfirm?: () => string|null|undefined,
 *   onClose?: () => void,
 *   captureKeys?: (keyval: number, keycode: number, state: number) => boolean}} options
 *   `onConfirm` returns an error message to keep the dialog open, or nothing to close it.
 *   `cancelLabel: null` leaves the Cancel button out. `captureKeys` sees every key press before
 *   the focused widget and returns true to swallow it.
 * @returns {{close: () => void, setError: (message: string|null) => void}}
 */
export function showDialog(parent, options) {
    const {
        title,
        content,
        confirmLabel = 'Save',
        cancelLabel = 'Cancel',
        width = 520,
        height = 560,
        onConfirm = () => null,
        onClose = null,
        captureKeys = null,
    } = options;

    const errorLabel = new Gtk.Label({
        wrap: true,
        xalign: 0,
        visible: false,
        css_classes: ['error'],
        selectable: true,
    });
    const body = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        margin_top: 12,
        margin_bottom: 24,
        margin_start: 18,
        margin_end: 18,
    });
    body.append(errorLabel);
    body.append(content);

    const scroller = new Gtk.ScrolledWindow({
        child: body,
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        propagate_natural_height: true,
        vexpand: true,
    });
    const header = new Adw.HeaderBar({
        show_start_title_buttons: false,
        show_end_title_buttons: false,
        title_widget: new Adw.WindowTitle({ title }),
    });
    const confirm = new Gtk.Button({ label: confirmLabel, css_classes: ['suggested-action'] });
    header.pack_end(confirm);
    if (cancelLabel !== null) {
        const cancel = new Gtk.Button({ label: cancelLabel });
        cancel.connect('clicked', () => dialog.close());
        header.pack_start(cancel);
    }
    const view = new Adw.ToolbarView({ content: scroller });
    view.add_top_bar(header);

    if (captureKeys) {
        const keys = new Gtk.EventControllerKey({
            propagation_phase: Gtk.PropagationPhase.CAPTURE,
        });
        keys.connect('key-pressed', (_c, keyval, keycode, state) =>
            captureKeys(keyval, keycode, state),
        );
        view.add_controller(keys);
    }

    let dialog;
    if (hasAdwDialog()) {
        dialog = new Adw.Dialog({
            title,
            child: view,
            content_width: width,
            follows_content_size: false,
        });
        dialog.set_default_widget(confirm);
        if (onClose) dialog.connect('closed', onClose);
    } else {
        dialog = new Adw.Window({
            title,
            modal: true,
            transient_for: rootWindow(parent),
            default_width: width,
            default_height: height,
            content: view,
        });
        dialog.set_default_widget(confirm);
        const esc = new Gtk.EventControllerKey();
        esc.connect('key-pressed', (_c, keyval) => {
            if (keyval !== 0xff1b) return false;
            dialog.close();
            return true;
        });
        dialog.add_controller(esc);
        if (onClose) dialog.connect('close-request', () => onClose() ?? false);
    }

    const setError = (message) => {
        errorLabel.set_label(message ?? '');
        errorLabel.set_visible(Boolean(message));
    };
    confirm.connect('clicked', () => {
        const message = onConfirm();
        if (message) setError(message);
        else dialog.close();
    });

    if (hasAdwDialog()) dialog.present(parent);
    else dialog.present();
    return { close: () => dialog.close(), setError };
}

/**
 * Ask before doing something. `onConfirm` runs only when the user picks the confirm button.
 * @param {Gtk.Widget} parent any widget that is inside the preferences window
 * @param {{heading: string, body: string, confirmLabel: string, destructive?: boolean,
 *   onConfirm: () => void}} options
 */
export function confirmDialog(parent, options) {
    const { heading, body, confirmLabel, destructive = false, onConfirm } = options;
    const modern = hasAlertDialog();
    const dialog = modern
        ? new Adw.AlertDialog({ heading, body })
        : new Adw.MessageDialog({ heading, body, modal: true, transient_for: rootWindow(parent) });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('confirm', confirmLabel);
    dialog.set_response_appearance(
        'confirm',
        destructive ? Adw.ResponseAppearance.DESTRUCTIVE : Adw.ResponseAppearance.SUGGESTED,
    );
    dialog.set_default_response('cancel');
    dialog.set_close_response('cancel');
    dialog.connect('response', (_d, id) => {
        if (id === 'confirm') onConfirm();
    });
    if (modern) dialog.present(parent);
    else dialog.present();
}
