# openclaw-telegram-manager

[![CI](https://github.com/jcoulaud/openclaw-telegram-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/jcoulaud/openclaw-telegram-manager/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/openclaw-telegram-manager)](https://www.npmjs.com/package/openclaw-telegram-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An [OpenClaw](https://openclaw.ai) plugin that gives each Telegram forum topic its own persistent workspace — status, todos, commands, links, notes — so nothing gets lost when the agent resets or context gets compacted.

## The problem

When OpenClaw manages a Telegram group with forum topics, each topic is basically a separate project. But after a reset or context compaction, the agent forgets everything: what it was working on, what's left to do, what commands matter.

This plugin fixes that. Each topic gets a folder of markdown files (a "capsule") that the agent reads on startup. It picks up right where it left off.

## Getting started

Requires OpenClaw `>=2026.1.0`.

```bash
npx openclaw-telegram-manager setup
```

That's it. The setup script installs the plugin, patches your config, creates the workspace, and restarts the Gateway. It's idempotent — running it twice won't break anything.

Once that's done:

1. Open any topic in your OpenClaw-managed Telegram group
2. Type `/topic init my-project coding`
3. The plugin creates a capsule folder for that topic and confirms in chat
4. From now on, the agent reads the capsule on every session start — no context lost

## Usage

| Command | What it does |
|---------|-------------|
| `/topic init <slug> [type]` | Register a topic and create its capsule. Types: `coding`, `research`, `marketing`, `custom` |
| `/topic status` | Show the current STATUS.md |
| `/topic list` | List all topics, grouped by status |
| `/topic doctor` | Run health checks on the current topic |
| `/topic doctor --all` | Health check all active topics at once |
| `/topic sync` | Regenerate the include file from the registry |
| `/topic rename <new-slug>` | Rename a topic |
| `/topic upgrade` | Upgrade the capsule to the latest template version |
| `/topic snooze <duration>` | Snooze a topic (e.g. `7d`, `30d`) |
| `/topic archive` | Archive a topic |
| `/topic unarchive` | Bring back an archived topic |
| `/topic help` | Show this command list in Telegram |

## What's in a capsule

Each topic gets a folder at `~/.openclaw/workspace/projects/<slug>/` with these files:

**Always included:**
- `STATUS.md` — what's happening, last activity, next 3 actions
- `TODO.md` — task backlog
- `COMMANDS.md` — build/deploy/test commands worth remembering
- `LINKS.md` — URLs and endpoints
- `CRON.md` — scheduled jobs
- `NOTES.md` — anything else worth keeping
- `README.md` — what this topic is about

**Extra files by type:**
- `coding` adds `ARCHITECTURE.md` and `DEPLOY.md`
- `research` adds `SOURCES.md` and `FINDINGS.md`
- `marketing` adds `CAMPAIGNS.md` and `METRICS.md`
- `custom` adds nothing — bring your own

## Permissions

Two roles:
- **User** — can manage topics they have access to
- **Admin** — can run `doctor --all` and manage anyone's topics

The first person to run `/topic init` automatically becomes admin.

## Project layout

```
src/
  index.ts          — plugin entry point
  tool.ts           — routes /topic subcommands
  setup.ts          — the setup CLI
  commands/         — one file per command
  lib/              — core logic (registry, capsules, security, auth, etc.)
  templates/        — markdown templates for new capsules
skills/
  topic/SKILL.md    — skill definition with rehydration behavior
```

## Security

- Path traversal protection (jail checks + symlink rejection)
- HMAC-signed inline keyboard callbacks
- HTML escaping on all Telegram output
- Schema validation on every registry read (bad entries get quarantined)
- File locking to prevent concurrent write corruption

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
