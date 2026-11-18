# dev-hop

[![CI](https://github.com/zarrx-dev/dev-hop/actions/workflows/ci.yml/badge.svg)](https://github.com/zarrx-dev/dev-hop/actions/workflows/ci.yml)
[![License: GPL-2.0](https://img.shields.io/badge/license-GPL--2.0-blue.svg)](LICENSE)

A GNOME Shell extension that gets you into your projects and servers in one step. Open the top bar menu or press Super+J, type a few letters, and press Enter to open a terminal, an editor or an SSH session at the right place.

## Features

- **Top bar menu and search popup.** Both list projects and SSH servers. The popup (Super+J by default) is keyboard driven: type to search, Up/Down to move, Enter to run the default action, Shift+Enter to choose another action, Esc to close.
- **Projects from several places:**
  - pinned folders you add by hand;
  - git repositories found under the search folders you choose (any folder, not tied to one layout);
  - recent folders from VS Code, VSCodium, Cursor, Zed, JetBrains IDEs and Claude Code.
- **SSH servers** from `~/.ssh/config`, including hosts from `Include` files.
- **Editable actions.** Every action is a command template you can change. Defaults:
  - projects: open a terminal, terminal + Claude Code, open in Zed, open in VS Code;
  - servers: SSH, SSH to a folder, Zed remote, VS Code remote.
- **Per-item defaults.** Pick a different default action for any project or server, from the menu, the popup or the settings.
- **ssh config editor.** Add, edit and delete hosts in the settings window. A timestamped backup is written before every change.
- **Only what you have.** Editors and terminals are detected from the programs installed, and actions whose program is missing are hidden.

## Requirements

- GNOME Shell 45 or newer. Tested on GNOME 46. Versions 45 and 47 to 50 are listed as supported but have not been tested yet.
- `sqlite3` on your PATH for recent folders from VS Code, VSCodium, Cursor and Zed (they store them in SQLite). Without it those sources show "Needs sqlite3" and everything else works. Install it with your package manager, for example `sudo apt install sqlite3` or `sudo dnf install sqlite`.

## Install

From source:

```sh
git clone https://github.com/zarrx-dev/dev-hop.git
cd dev-hop
make install
```

Then log out and back in (on Wayland), and enable it:

```sh
gnome-extensions enable dev-hop@zarrx
```

Open the settings with `gnome-extensions prefs dev-hop@zarrx`, or from Settings in the top bar menu.

## Command templates

A template is split into arguments first, and placeholders are filled inside each argument afterwards. A project name or path can never add arguments, and nothing runs through `sh -c`.

| Placeholder | Value |
|---|---|
| `{path}` | Project folder |
| `{name}` | Project or host name |
| `{host}` | SSH host alias |
| `{user}` | SSH user, if set |
| `{remoteDir}` | Remote folder set for the host, for example `~/deployments` |
| `{remoteDirUrl}` | The remote folder with a leading `/`, for URLs such as `ssh://host/~/app` |
| `{remoteCmd}` | `cd <remote folder>; exec "$SHELL" -l`, with the folder quoted |

Actions marked "run in terminal" open in the terminal chosen on the General page (or the first installed one). Supported terminals: GNOME Terminal, Ptyxis, Console, Kitty, Alacritty, WezTerm, Ghostty, Konsole and Tilix. Only the GNOME Terminal flags have been checked on a live install so far.

## ssh config safety

- Only the `Host` block you edit is changed. Comments, blank lines, `Match` blocks and every other line are kept as they are.
- Hosts from `Include` files are shown read-only. Wildcard hosts are not listed.
- Before each write the current file is copied to `config.YYYYMMDD-HHMMSS.bak` next to it. The new file is written to a temp file and renamed into place, with mode 600.
- The file path can be changed on the General page.

## Development

```sh
make lint     # Biome
make test     # unit tests under gjs
make pack     # build/dev-hop@zarrx.shell-extension.zip
make nested   # run a nested GNOME Shell with the extension enabled
```

`make nested` uses its own D-Bus session and settings under `scratchpad/nested`, and points the ssh config path at a test copy, so it never touches your real settings or `~/.ssh/config`.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and [SECURITY.md](SECURITY.md) to report a security problem.

## License

GPL-2.0. See [LICENSE](LICENSE).

Designed & developed by Zarrx Technologies.
