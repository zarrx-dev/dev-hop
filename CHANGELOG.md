# Changelog

## Unreleased

### Added

- docs: README, contributing guide, security policy and code of conduct.
- ci: lint and unit tests on every push and pull request.
- extension: top bar menu and Super+J search popup listing projects and SSH servers, with search, keyboard navigation, an action chooser and per-item default actions.
- extension: projects from pinned folders, a git scan of chosen search folders, and recent folders from VS Code, VSCodium, Cursor, Zed, JetBrains IDEs and Claude Code.
- extension: SSH servers from `~/.ssh/config`, including `Include` files.
- extension: editable command templates for project and server actions; actions whose program is not installed are hidden.
- prefs: Projects, Servers, Actions and General pages, including adding, editing and deleting ssh hosts with a timestamped backup before every write.

### Fixed

- extension: programs in `~/.local/bin` and other per-user folders are found even when the desktop session PATH does not include them.
