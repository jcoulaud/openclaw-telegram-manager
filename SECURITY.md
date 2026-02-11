# Security

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting vulnerabilities

Don't open a public issue. Instead:

1. Email the maintainers with a description, steps to reproduce, and potential impact.
2. You'll get an acknowledgment within 48 hours.
3. We'll work with you on a fix and coordinate disclosure.

## What's covered

- Registry file handling (`topics.json` read/write/validation)
- Path traversal and symlink checks
- HMAC callback authentication
- HTML escaping in Telegram output
- File locking and atomic writes
- Setup script permissions

## How things are protected

- **Path jail** — capsule paths are resolved to absolute and checked against the workspace root.
- **Symlink rejection** — symlinks in capsule paths are blocked.
- **HMAC signatures** — inline keyboard callbacks are signed with a per-registry secret.
- **HTML escaping** — user data in Telegram messages is always escaped before rendering.
- **Schema validation** — registry entries are validated on every read. Invalid entries get quarantined instead of crashing.
- **File locking** — `proper-lockfile` prevents concurrent writes from corrupting the registry.
