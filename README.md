# Persistent Memory for OpenClaw Telegram Topics

[![CI](https://github.com/jcoulaud/openclaw-telegram-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/jcoulaud/openclaw-telegram-manager/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/openclaw-telegram-manager)](https://www.npmjs.com/package/openclaw-telegram-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

`openclaw-telegram-manager` — an [OpenClaw](https://openclaw.ai) plugin that gives each Telegram topic its own persistent memory, so nothing gets lost when the AI resets or context gets compacted.

## The problem

When OpenClaw manages a Telegram group with topics, each topic is basically a separate project. But after a reset or context compaction, the AI forgets everything: what it was working on, what's left to do, what commands matter.

This plugin fixes that. Each topic gets a folder of persistent files that the AI reads automatically on startup. It picks up right where it left off.

## Prerequisites

- [OpenClaw](https://openclaw.ai) `>=2026.1.0` installed and running
- A Telegram group with [topics enabled](https://telegram.org/blog/tms-in-groups-collectible-usernames#topics-in-groups) and managed by OpenClaw

## Install

```bash
npx openclaw-telegram-manager setup
```

That's it. The setup script installs the plugin, patches your config, creates the workspace, and restarts the OpenClaw gateway. It's idempotent — running it twice won't break anything.

<details>
<summary>Security warnings during install</summary>

OpenClaw's automatic scanner may flag `child_process` and `process.env` usage. These are expected — the setup script calls `openclaw --version`, `openclaw plugins install`, and `openclaw gateway restart`, and reads `process.env` for config directory detection. No data is sent externally.

</details>

## How it works

1. **One-time setup per topic**
   Open a Telegram topic and type `/tm init`. Pick a type (Coding, Research, Marketing, or General). Done.

2. **Everything else is automatic**
   The AI reads and updates the topic's files on its own — tracking progress, TODOs, decisions, and learnings. When context gets compacted or the AI resets, it re-reads these files and continues where it left off.

3. **Health checks and daily reports run in the background**
   Autopilot is enabled by default — the plugin checks all your topics daily and posts a progress report, only when something needs attention.

You can also skip the interactive flow: `/tm init my-project coding`

## Topic memory vs. workspace memory

OpenClaw has its own workspace-level memory (learnings, preferences, patterns). This plugin adds a **per-topic layer on top**.

The AI treats these as a hierarchy:
1. **Topic files come first** — they define what the topic is working on, its tasks, progress, and history. After a reset, the AI reads these before anything else.
2. **Workspace memory is secondary** — general learnings and user preferences still apply (coding style, past mistakes), but they don't override the topic's current state.

In practice: if the AI resets and you ask "what are we working on?", it answers from the topic's status and tasks — not from unrelated projects that might exist elsewhere in the workspace.

## What gets tracked

Each topic gets its own folder with three files the AI maintains automatically:

| File | Purpose |
|------|---------|
| `README.md` | What this topic is about, goals, key resources, and type-specific sections |
| `STATUS.md` | Last activity, next actions, upcoming work, backlog, and completed tasks |
| `LEARNINGS.md` | Insights, mistakes, workarounds |

The README includes type-specific sections depending on the topic:
- **Coding** adds Architecture, Deployment, and Commands sections
- **Research** adds Sources and Findings sections
- **Marketing** adds Campaigns and Metrics sections

These files are committed to your workspace git repo so they persist and have history. Operational files (the internal registry and audit log) are automatically added to `.gitignore` during setup.

## Optional commands

You don't need any of these — everything runs automatically. They're there if you want to check on things or make changes.

**Check on things**

| Command | What it does |
|---------|-------------|
| `/tm status` | See current progress (`--expanded` for full details) |
| `/tm doctor` | Run health checks |
| `/tm doctor --all` | Health check all topics at once |
| `/tm daily-report` | Post a daily summary |
| `/tm daily-report --all` | Post daily summaries for all topics |
| `/tm list` | List all topics |

**Make changes**

| Command | What it does |
|---------|-------------|
| `/tm rename <new-name>` | Rename a topic |
| `/tm snooze <duration>` | Pause health checks (e.g. `7d`, `30d`) |
| `/tm archive` | Archive a topic |
| `/tm unarchive` | Bring back an archived topic |

**Autopilot** (enabled by default)

| Command | What it does |
|---------|-------------|
| `/tm autopilot status` | Check if autopilot is on and when it last ran |
| `/tm autopilot disable` | Turn off automatic health checks and daily reports |
| `/tm autopilot enable` | Re-enable if you previously disabled it |

## Permissions

Two roles:
- **User** — can manage topics they have access to
- **Admin** — can run `doctor --all`, `daily-report --all`, and manage anyone's topics

The first person to run `/tm init` automatically becomes admin.

## Security

- Path traversal protection (jail checks + symlink rejection)
- HMAC-signed inline keyboard callbacks
- HTML escaping on direct Telegram API posts
- Schema validation on every registry read (bad entries get quarantined)
- File locking to prevent concurrent write corruption

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Uninstalling

```bash
npx openclaw-telegram-manager uninstall
```

This removes any scheduled cron jobs, the autopilot heartbeat block, the plugin, the config reference, and the generated include file, then restarts the gateway. You'll be asked whether to delete your topic data. To skip the prompt and delete everything:

```bash
npx openclaw-telegram-manager uninstall --purge-data
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

### Project layout

```
src/
  index.ts          — plugin entry point
  tool.ts           — routes /tm sub-commands
  setup.ts          — the setup CLI
  commands/         — one file per command
  lib/              — core logic (registry, security, auth, etc.)
  templates/        — markdown templates for new topics
dist/
  plugin.js         — bundled plugin (esbuild, all deps included)
skills/
  tm/SKILL.md       — AI behavior hints (not user-invocable)
```

`npm run build` compiles TypeScript then bundles into `dist/plugin.js`. The setup script copies only the bundle — no `node_modules` needed at runtime.

## License

[MIT](LICENSE)
