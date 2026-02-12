# openclaw-telegram-manager [WIP]

> **This project is a work in progress and is not yet functional.** I'm actively working on it — expect breaking changes, incomplete features, and rough edges. Feel free to watch the repo, but don't use it in production yet.

[![CI](https://github.com/jcoulaud/openclaw-telegram-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/jcoulaud/openclaw-telegram-manager/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/openclaw-telegram-manager)](https://www.npmjs.com/package/openclaw-telegram-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An [OpenClaw](https://openclaw.ai) plugin that gives each Telegram topic its own persistent workspace — status, todos, commands, links, notes — so nothing gets lost when the agent resets or context gets compacted.

## The problem

When OpenClaw manages a Telegram group with topics, each topic is basically a separate project. But after a reset or context compaction, the agent forgets everything: what it was working on, what's left to do, what commands matter.

This plugin fixes that. Each topic gets a folder of markdown files (a "capsule") that the agent reads on startup. It picks up right where it left off.

## Prerequisites

- [OpenClaw](https://openclaw.ai) `>=2026.1.0` installed and running
- A Telegram group with [topics enabled](https://telegram.org/blog/tms-in-groups-collectible-usernames#topics-in-groups) and managed by OpenClaw

## Getting started

```bash
npx openclaw-telegram-manager setup
```

That's it. The setup script installs the plugin, patches your config, creates the workspace, and restarts the OpenClaw gateway. It's idempotent — running it twice won't break anything.

**Security warnings during install:** OpenClaw's automatic scanner may flag `child_process` and `process.env` usage. These are expected — the setup script calls `openclaw --version`, `openclaw plugins install`, and `openclaw gateway restart`, and reads `process.env` for config directory detection. No data is sent externally.

Once that's done, head to your Telegram group:

1. Open any topic
2. Type `/tm init` in the chat
3. Pick a topic type (Coding, Research, Marketing, or Custom)
4. The plugin creates a capsule (a folder of markdown files — see below) and confirms in chat
5. From now on, the agent reads the capsule on every session start — no context lost

You can also skip the interactive flow: `/tm init my-project coding` (the first argument is the display name, second is the type)

## Commands

All commands are typed directly in the Telegram group chat:

| Command | What it does |
|---------|-------------|
| `/tm init` | Interactive setup — pick a topic type |
| `/tm init [name] [type]` | One-step setup. Types: `coding`, `research`, `marketing`, `custom` |
| `/tm status` | Show the current STATUS.md |
| `/tm list` | List all topics, grouped by status |
| `/tm doctor` | Run health checks on the current topic |
| `/tm doctor --all` | Health check all active topics at once |
| `/tm sync` | Regenerate the include file from the registry |
| `/tm rename <new-name>` | Rename a topic's display name |
| `/tm upgrade` | Upgrade the capsule to the latest template version |
| `/tm snooze <duration>` | Snooze a topic (e.g. `7d`, `30d`) |
| `/tm archive` | Archive a topic |
| `/tm unarchive` | Bring back an archived topic |
| `/tm help` | Show this command list in Telegram |

## What's in a capsule

Each topic gets a folder at `~/.openclaw/workspace/projects/t-<threadId>/` with these files:

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

The first person to run `/tm init` automatically becomes admin.

## Security

- Path traversal protection (jail checks + symlink rejection)
- HMAC-signed inline keyboard callbacks
- HTML escaping on all Telegram output
- Schema validation on every registry read (bad entries get quarantined)
- File locking to prevent concurrent write corruption

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Uninstalling

```bash
npx openclaw-telegram-manager uninstall
```

This removes the plugin extension files, the `$include` reference from `openclaw.json`, and the generated include file, then restarts the gateway. Workspace data (your topic capsules) is kept — the command prints the path if you want to remove it manually.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

### Project layout

```
src/
  index.ts          — plugin entry point (source)
  tool.ts           — routes /tm sub-commands
  setup.ts          — the setup CLI
  commands/         — one file per command
  lib/              — core logic (registry, capsules, security, auth, etc.)
  templates/        — markdown templates for new capsules
dist/
  plugin.js         — bundled plugin (built by esbuild, all deps included)
skills/
  tm/SKILL.md       — model-only proactive behavior hints (not user-invocable)
```

`npm run build` compiles TypeScript then bundles `src/index.ts` into `dist/plugin.js` with all dependencies. The setup script copies only the bundle — no `node_modules` needed at runtime.

## License

[MIT](LICENSE)
