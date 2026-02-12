# Security

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting vulnerabilities

Don't open a public issue. Instead, use [GitHub's private vulnerability reporting](https://github.com/jcoulaud/openclaw-telegram-manager/security/advisories/new):

1. Submit a report with a description, steps to reproduce, and potential impact.
2. You'll get an acknowledgment within 48 hours.
3. We'll work with you on a fix and coordinate disclosure.

## What's covered

- Registry file handling (`topics.json` read/write/validation)
- Path traversal and symlink checks
- HMAC callback authentication
- HTML escaping in direct Telegram API posts
- File locking and atomic writes
- Setup script permissions

## How things are protected

- **Path jail** — capsule paths are resolved to absolute and checked against the workspace root.
- **Symlink rejection** — symlinks in capsule paths are blocked.
- **HMAC signatures** — inline keyboard callbacks are signed with a per-registry secret.
- **HTML escaping** — user data in direct Telegram API posts (fan-out doctor reports) is HTML-escaped. Command responses use Markdown, which the gateway's text pipeline auto-converts safely.
- **Schema validation** — registry entries are validated on every read. Invalid entries get quarantined instead of crashing.
- **File locking** — `proper-lockfile` prevents concurrent writes from corrupting the registry.
