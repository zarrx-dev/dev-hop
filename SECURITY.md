# Security policy

dev-hop runs commands on your machine and can edit `~/.ssh/config`, so security reports are taken seriously.

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub instead: open the repository's **Security** tab and choose **Report a vulnerability**.

Include the GNOME Shell version, the steps to reproduce and the impact you see. You should get a reply within a week. Once a fix is released, the report is published with credit to you unless you prefer otherwise.

## In scope

- A project path, host name or other value causing extra arguments or shell commands to run.
- Changes to `~/.ssh/config` outside the edited `Host` block, a lost backup, or wrong file permissions.
- Reading or exposing data the extension does not need.
