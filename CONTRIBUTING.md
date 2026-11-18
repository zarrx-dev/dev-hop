# Contributing to dev-hop

Thanks for taking the time to help. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

Open an issue with the bug template. Include:

- your GNOME Shell version (`gnome-shell --version`) and distribution;
- Wayland or X11;
- what you did, what you expected and what happened;
- any errors from `journalctl -b -o cat /usr/bin/gnome-shell | grep -i dev-hop`.

Do not paste your `~/.ssh/config` or other private data into an issue. Reduce it to the smallest example that shows the problem, with made-up host names.

## Suggesting a feature

Open an issue with the feature template and describe the problem you want solved before the solution. Larger changes are easier to agree on in an issue before any code is written.

## Development setup

You need GNOME Shell 45 or newer, `gjs`, `make`, `glib-compile-schemas` and Node.js (for `npx` and Biome).

```sh
make lint     # Biome lint and format check
make test     # unit tests under gjs
make nested   # run a nested GNOME Shell with the extension enabled
make install  # install into your session (log out and back in on Wayland)
```

`make nested` runs in its own D-Bus session with its own settings under `scratchpad/nested`, and points the ssh config path at a test copy, so testing never touches your real settings or `~/.ssh/config`.

## Code layout

- `extension/src/core/`: pure logic with no GNOME Shell imports (ssh config, templates, fuzzy search, presets). Unit tested under plain gjs.
- `extension/src/sources/`: project and server sources and the merging manager.
- `extension/src/actions/`: builds and runs action commands.
- `extension/src/ui/`: top bar menu, search popup and action chooser.
- `extension/src/prefs/`: the preferences window.
- UI changes should follow the GNOME Human Interface Guidelines and the existing look; include before and after screenshots in the pull request.

## Pull requests

- Keep each pull request to one change, and link the issue it addresses.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages, for example `fix(prefs): keep the window open when the default changes`.
- `make lint` and `make test` must pass. Add tests for new logic in `src/core` or `src/sources`.
- Add a line to `CHANGELOG.md` under Unreleased for user-visible changes.
- Follow the extensions.gnome.org review rules: create nothing in the constructor, undo everything in `disable()`, and avoid synchronous IO in the shell process.
- Commands must never run through a shell. Templates are split into arguments first and placeholders are filled inside each argument.
- Changes that write to `~/.ssh/config` must keep the backup-before-write behaviour and leave unrelated lines untouched.

## License

By contributing you agree that your contributions are licensed under the GPL-2.0, the same license as the project.
