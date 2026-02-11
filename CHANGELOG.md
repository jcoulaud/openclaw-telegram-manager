# 1.0.0 (2026-02-11)


### Bug Fixes

* use audit-ci with allowlist for upstream tar vulnerabilities ([d8cc664](https://github.com/jcoulaud/openclaw-telegram-manager/commit/d8cc664ca1e22701836d778d2bcc10a71589e478))

# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning follows [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-02-11

Initial release.

### Added

- `/topic init` — register a topic and scaffold its capsule folder
- `/topic doctor` — per-topic health checks with inline keyboard actions
- `/topic doctor --all` — batch health check across all active topics
- `/topic list` — list topics grouped by status
- `/topic status` — quick STATUS.md view
- `/topic sync` — regenerate include file from the registry
- `/topic rename` — rename a topic slug
- `/topic upgrade` — upgrade capsule to latest templates
- `/topic snooze` — snooze a topic for a given duration
- `/topic archive` / `/topic unarchive` — archive or restore topics
- `/topic help` — command reference
- Registry with atomic JSON I/O, file locking, schema validation, and migrations
- Capsule scaffolding with base templates + type overlays (coding, research, marketing, custom)
- Include file generation with JSON5 and round-trip validation
- Two-tier auth (user/admin) with first-user bootstrap
- HMAC-signed inline keyboard callbacks
- Append-only audit trail (`audit.jsonl`)
- Config restart via `config.patch` with retry and cooldown
- Doctor checks: registry integrity, capsule structure, status quality, cron, config, include drift, spam control
- Setup CLI (`npx openclaw-telegram-manager setup`) — 11 idempotent steps
- Skill definition (`skills/topic/SKILL.md`) with proactive rehydration
- GitHub Actions CI (lint, test, audit, publish with provenance)
