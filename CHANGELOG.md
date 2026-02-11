## [1.3.2](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.3.1...v1.3.2) (2026-02-11)


### Bug Fixes

* always refresh plugin files on setup for upgrades ([c544110](https://github.com/jcoulaud/openclaw-telegram-manager/commit/c544110f1f836c781945a2bbf5ff26cc0d58c05a))
* reorder uninstall to avoid gateway hot-reload race ([2b94167](https://github.com/jcoulaud/openclaw-telegram-manager/commit/2b941678c94fec484b33f938698289a742243ec9))

## [1.3.1](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.3.0...v1.3.1) (2026-02-11)


### Bug Fixes

* fail on missing bundle and harden build config ([6324005](https://github.com/jcoulaud/openclaw-telegram-manager/commit/6324005f36c6b8c8a33286f6c1c8bf3401f95541))
* preserve existing inline groups config during setup ([48d12c3](https://github.com/jcoulaud/openclaw-telegram-manager/commit/48d12c39fe2925e736f8469808174d521a4246cf))

# [1.3.0](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.2.0...v1.3.0) (2026-02-11)


### Bug Fixes

* resolve configDir from plugin path when host does not provide it ([6348666](https://github.com/jcoulaud/openclaw-telegram-manager/commit/63486667f2329bb75a017cf2f24ab429064d1c46))


### Features

* bundle plugin with esbuild, remove runtime npm install ([e309f8c](https://github.com/jcoulaud/openclaw-telegram-manager/commit/e309f8c7171be0c891baef44126e1b910559a5e1))

# [1.2.0](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.1.1...v1.2.0) (2026-02-11)


### Bug Fixes

* copy dependencies from npx context during setup ([5d354e7](https://github.com/jcoulaud/openclaw-telegram-manager/commit/5d354e7f500873539e25d2e4d69a290317485625))


### Features

* add animated spinner to CLI setup and uninstall steps ([542efa9](https://github.com/jcoulaud/openclaw-telegram-manager/commit/542efa9059b787024012a6a609d181e28bd978ba))

## [1.1.1](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.1.0...v1.1.1) (2026-02-11)


### Bug Fixes

* install npm dependencies after copying plugin files ([8cf1a82](https://github.com/jcoulaud/openclaw-telegram-manager/commit/8cf1a823df97e765210529d4691f91841e738658))
* read plugin version from package.json instead of hardcoded value ([80fa8f8](https://github.com/jcoulaud/openclaw-telegram-manager/commit/80fa8f88c000030bd2b3ad0a5f7c3046793cd31d))

# [1.1.0](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.0.1...v1.1.0) (2026-02-11)


### Features

* add uninstall command, fix plugin manifest, improve setup UX ([59134dd](https://github.com/jcoulaud/openclaw-telegram-manager/commit/59134dda11a9bfbf129ea1b9de155e5d27eec7ac))

## [1.0.1](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.0.0...v1.0.1) (2026-02-11)


### Bug Fixes

* upgrade npm in release job for trusted publishing support ([4b51dbf](https://github.com/jcoulaud/openclaw-telegram-manager/commit/4b51dbf000eaf992614b9012e757825b5258b7d0))
* upgrade semantic-release plugins for trusted publishing ([91ce154](https://github.com/jcoulaud/openclaw-telegram-manager/commit/91ce154138c58256070a913cca5a95a8565a1395))
* use npm install in release job for npm 11 compatibility ([dc50d12](https://github.com/jcoulaud/openclaw-telegram-manager/commit/dc50d12cb18ac5cec97fed42ab1cbaf0614ea50b))

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
