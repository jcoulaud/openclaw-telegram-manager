## [2.11.1](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.11.0...v2.11.1) (2026-02-14)


### Bug Fixes

* remove heartbeat block during uninstall ([0dd9dfd](https://github.com/jcoulaud/openclaw-telegram-manager/commit/0dd9dfde8e59cd60c5f87482c65f5b1a786714cb))

# [2.11.0](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.10.0...v2.11.0) (2026-02-14)


### Features

* remove cron jobs during uninstall ([4293ea4](https://github.com/jcoulaud/openclaw-telegram-manager/commit/4293ea4067234adaee19c567d4b57c19bcd465f5))

# [2.10.0](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.9.0...v2.10.0) (2026-02-14)


### Features

* add daily-report --all and single combined cron job ([f5811cf](https://github.com/jcoulaud/openclaw-telegram-manager/commit/f5811cfb06ab10c7fb1a340ec8e0c4510b4a4b33))

# [2.9.0](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.8.0...v2.9.0) (2026-02-14)


### Bug Fixes

* auto-upgrade capsules during doctor --all for autopilot users ([da195a9](https://github.com/jcoulaud/openclaw-telegram-manager/commit/da195a9c9ddbad896f461aa6ed2e0e276d99eed2))


### Features

* consolidate capsule to 3 files with type-specific README sections ([55e8770](https://github.com/jcoulaud/openclaw-telegram-manager/commit/55e8770aad856e361d00853f129e5b3f35895e74))

# [2.8.0](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.7.0...v2.8.0) (2026-02-13)


### Features

* add structured sections to templates and proactive context persistence ([3e4de82](https://github.com/jcoulaud/openclaw-telegram-manager/commit/3e4de82c7bc9f74358b452c1f86d89587085a1ba))

# [2.7.0](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.6.3...v2.7.0) (2026-02-13)


### Features

* add reliability plan — post-failure tracking, cron daily reports, status output ([37245b4](https://github.com/jcoulaud/openclaw-telegram-manager/commit/37245b4dc3535d496bb122cb6e5a750a70b7ea74))

## [2.6.3](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.6.2...v2.6.3) (2026-02-13)


### Bug Fixes

* make sync command messages user-friendly and gate restart behind configWrites ([1b1ceff](https://github.com/jcoulaud/openclaw-telegram-manager/commit/1b1ceff10c852e4437ebba5b2445a5367c813395))

## [2.6.2](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.6.1...v2.6.2) (2026-02-13)


### Bug Fixes

* move entry-point to end of setup.ts to fix bundled variable ordering ([e3172a4](https://github.com/jcoulaud/openclaw-telegram-manager/commit/e3172a4e2b8a7ad62dea8a9864eafee6514e86e7))

## [2.6.1](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.6.0...v2.6.1) (2026-02-13)


### Bug Fixes

* add registry migration for custom-to-general topic type rename ([52f2d5e](https://github.com/jcoulaud/openclaw-telegram-manager/commit/52f2d5e0624616d467085657b31014e1f0ac916b))

# [2.6.0](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.5.7...v2.6.0) (2026-02-13)


### Bug Fixes

* doctor-all inactivity check now considers STATUS.md activity ([1cf0c01](https://github.com/jcoulaud/openclaw-telegram-manager/commit/1cf0c0145eb936fdc65938e1f2fbbbcce13c8f50))
* remove markdown italic underscores from daily report placeholders ([bbfa12e](https://github.com/jcoulaud/openclaw-telegram-manager/commit/bbfa12e068860ed4f46114ad6ca41cbd0f062c6b))


### Features

* add context hierarchy so topic files override workspace memory ([4d84269](https://github.com/jcoulaud/openclaw-telegram-manager/commit/4d842693235f78b970293b83b81b70e4749ab9b2))
* gitignore operational files in workspace during setup ([65af991](https://github.com/jcoulaud/openclaw-telegram-manager/commit/65af991a36b9dc1df44b86cfee99533cf9ab1a30))
* redesign doctor-all summary and add icons to status/list output ([fbc4bd5](https://github.com/jcoulaud/openclaw-telegram-manager/commit/fbc4bd509699b0dc0a18c4ca5bb18fed949e8874))

## [2.5.7](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.5.6...v2.5.7) (2026-02-13)


### Bug Fixes

* fall back to first admin when autopilot runs doctor --all without user context ([f0c6bab](https://github.com/jcoulaud/openclaw-telegram-manager/commit/f0c6bab45bb1bc92dd7158997edc2e83a21316de))
* show human-friendly name in setup/uninstall banner ([9cf7059](https://github.com/jcoulaud/openclaw-telegram-manager/commit/9cf705936d0c8479a0d9af4fffb80c1b0ced71a1))

## [2.5.6](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.5.5...v2.5.6) (2026-02-13)


### Bug Fixes

* always regenerate include file after init/rename/archive ([f0e016a](https://github.com/jcoulaud/openclaw-telegram-manager/commit/f0e016ae6b6c21b4317342aeffbda7fd1b564c39))

## [2.5.5](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.5.4...v2.5.5) (2026-02-13)


### Bug Fixes

* make bare /tm default to help instead of showing a plain error ([e077e11](https://github.com/jcoulaud/openclaw-telegram-manager/commit/e077e11182a6a582b11b89b5962c3364963230a5))

## [2.5.4](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.5.3...v2.5.4) (2026-02-13)


### Bug Fixes

* deduplicate AI-reworded memoryFlush instructions on reinstall ([932798d](https://github.com/jcoulaud/openclaw-telegram-manager/commit/932798dffe5e3ed5de6f18815fe040166085b2a3))
* match full ISO timestamps in status and label relative times in list ([c85db08](https://github.com/jcoulaud/openclaw-telegram-manager/commit/c85db089db178fb0a5fc7d633751e3fe7dc57ed0))

## [2.5.3](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.5.2...v2.5.3) (2026-02-13)


### Bug Fixes

* make memoryFlush patch idempotent across instruction rewording ([0884a6a](https://github.com/jcoulaud/openclaw-telegram-manager/commit/0884a6a71e74255d1f8b845b023d4d3d3c954e60))
* make memoryFlush patch idempotent across instruction rewording ([9463c05](https://github.com/jcoulaud/openclaw-telegram-manager/commit/9463c05b85c3af1d1ae8942b729d1d9424d408a4))

## [2.5.2](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.5.1...v2.5.2) (2026-02-13)


### Bug Fixes

* restore group config on uninstall by parsing JSON5 include file ([5fa3a15](https://github.com/jcoulaud/openclaw-telegram-manager/commit/5fa3a159f5af244bc7b8b3d14f26418bb3d636ef))

## [2.5.1](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.5.0...v2.5.1) (2026-02-13)


### Bug Fixes

* improve onboarding UX — restore "How it works" and add patience note ([f27ba94](https://github.com/jcoulaud/openclaw-telegram-manager/commit/f27ba94c60fcb47cf17c5a278bdc0b31f3b875fa))
* make onboarding messages user-friendly ([2d0e3ae](https://github.com/jcoulaud/openclaw-telegram-manager/commit/2d0e3ae0f3a703cf87be944cda21e23a9d07b62b))
* remove all remaining developer jargon from user-facing messages ([e8b2eb1](https://github.com/jcoulaud/openclaw-telegram-manager/commit/e8b2eb125f0173d80f7704eced314749a4eaf03e))
* remove remaining "workcell" terminology from onboarding and tool descriptions ([fb972a6](https://github.com/jcoulaud/openclaw-telegram-manager/commit/fb972a6023abdc8c68f0415be80f5e354bfbc6c0))

# [2.5.0](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.4.0...v2.5.0) (2026-02-13)


### Features

* auto-enable autopilot and integrate daily reports into doctor-all ([11b075d](https://github.com/jcoulaud/openclaw-telegram-manager/commit/11b075d1f56a98926b06c3dfd9c7a0d8c6b51640))

# [2.4.0](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.3.2...v2.4.0) (2026-02-13)


### Features

* comprehensive UX polish for all user-facing messages ([1302f75](https://github.com/jcoulaud/openclaw-telegram-manager/commit/1302f7577f42e3a59dab89c7dba8594089254fe5))

## [2.3.2](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.3.1...v2.3.2) (2026-02-13)


### Bug Fixes

* wire postFn via api.runtime instead of broken SDK import ([90cdda4](https://github.com/jcoulaud/openclaw-telegram-manager/commit/90cdda47e8580641176824fe7750c978d3d59574))

## [2.3.1](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.3.0...v2.3.1) (2026-02-12)


### Bug Fixes

* forward inlineKeyboard from tool execute for callback responses ([fd560ce](https://github.com/jcoulaud/openclaw-telegram-manager/commit/fd560ce244499efa27080db21c1a6f5c858dcd21))

# [2.3.0](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.2.2...v2.3.0) (2026-02-12)


### Bug Fixes

* revert memory flush prompt patch on uninstall ([4443e25](https://github.com/jcoulaud/openclaw-telegram-manager/commit/4443e25d9e1c197a69ad317254e613efbf2d5227))


### Features

* interactive init flow with direct Telegram posting via postFn ([574ce20](https://github.com/jcoulaud/openclaw-telegram-manager/commit/574ce20ae1240dbca3c2f71c4568ff6b4173219d))

## [2.2.2](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.2.1...v2.2.2) (2026-02-12)


### Bug Fixes

* move SETUP_REGISTRY_VERSION to top-level constants to avoid TDZ error ([430d6f1](https://github.com/jcoulaud/openclaw-telegram-manager/commit/430d6f15e25fdc220f6b4b571f90fec849673676))

## [2.2.1](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.2.0...v2.2.1) (2026-02-12)


### Bug Fixes

* clarify uninstall data deletion prompt ([3ea031b](https://github.com/jcoulaud/openclaw-telegram-manager/commit/3ea031b415fa8ca82a926d2c6e0c33d3da3f6c7d))
* move MEMORY_FLUSH_MARKER to top-level constants to avoid TDZ error ([675f639](https://github.com/jcoulaud/openclaw-telegram-manager/commit/675f63952c32d076c0089b8499f74f3265686d2c))

# [2.2.0](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.1.0...v2.2.0) (2026-02-12)


### Bug Fixes

* remove workspace data on uninstall instead of keeping it ([be1c27e](https://github.com/jcoulaud/openclaw-telegram-manager/commit/be1c27ec3808972303133f61132b8817c14d6e99))
* throw on unavailable SDK postFn and prompt before deleting workspace data ([81332ab](https://github.com/jcoulaud/openclaw-telegram-manager/commit/81332abdd1e8c3540c1d09c2d2b7f3391f49b5c3))


### Features

* add 5 determinism improvements for topic capsules ([9f0efd2](https://github.com/jcoulaud/openclaw-telegram-manager/commit/9f0efd21f0983e01a1f6ad48b8a7b735b89c77e0))
* add two-tier STATUS.md queue, daily reports, and activity tiers ([620acb4](https://github.com/jcoulaud/openclaw-telegram-manager/commit/620acb4dab3cbcc78c0467f70d884320e8ee3a29))
* switch command responses from HTML to Markdown formatting ([a26d115](https://github.com/jcoulaud/openclaw-telegram-manager/commit/a26d115cfaa1038657d36635ef8c5829ea58beec))

# [2.1.0](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.0.2...v2.1.0) (2026-02-12)


### Features

* add autopilot daily sweeps, LEARNINGS.md capsule, and bug fixes ([4ee4e5d](https://github.com/jcoulaud/openclaw-telegram-manager/commit/4ee4e5d9b00cb92410c6eef86b6bb7d71a527f39))
* improve post-init onboarding and add name confirmation step ([4dbdb02](https://github.com/jcoulaud/openclaw-telegram-manager/commit/4dbdb02185ffc7131e5a7aa02ba050bbdca94339))

## [2.0.2](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.0.1...v2.0.2) (2026-02-12)


### Bug Fixes

* embed userId in callback data so callbacks work without execContext ([2e8477d](https://github.com/jcoulaud/openclaw-telegram-manager/commit/2e8477dad0c5ff995ce9b5fc944ebbdd1244eaa7))

## [2.0.1](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v2.0.0...v2.0.1) (2026-02-12)


### Bug Fixes

* resolve callback missing context and bootstrap auth for user-tier commands ([c18417a](https://github.com/jcoulaud/openclaw-telegram-manager/commit/c18417aa1e6f4036e79abde1a92397339a179086))

# [2.0.0](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.3.11...v2.0.0) (2026-02-12)


* feat!: separate slug (stable ID) from name (display label) ([6df07c9](https://github.com/jcoulaud/openclaw-telegram-manager/commit/6df07c90ca4d2b6ffbba482f3295fc246fe2518b))


### BREAKING CHANGES

* Registry schema bumped to v2. Existing v1 registries
are auto-migrated (name = slug). Callback format changed from 6 parts
to 5 (slug removed). Init flow simplified from 3 steps to 2 (no slug
confirmation). Rename is now a metadata-only name change with no
filesystem operations. Slugs are auto-generated as t-{threadId}.

## [1.3.11](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.3.10...v1.3.11) (2026-02-12)


### Bug Fixes

* add from property to registerCommand handler ctx type ([6d1bbed](https://github.com/jcoulaud/openclaw-telegram-manager/commit/6d1bbed2a574908e4634ef22de5587d6de7f0f8c))
* extract groupId from ctx.from instead of ctx.channel ([f62fd67](https://github.com/jcoulaud/openclaw-telegram-manager/commit/f62fd67bb6d299e032f3c6141d625f1c19d65b26))

## [1.3.10](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.3.9...v1.3.10) (2026-02-12)


### Bug Fixes

* strip :topic: suffix from channel when extracting groupId ([a618e0e](https://github.com/jcoulaud/openclaw-telegram-manager/commit/a618e0e7b5d4c9e9fdbe167ebb3bc6d0dffb3c6e))

## [1.3.9](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.3.8...v1.3.9) (2026-02-12)


### Bug Fixes

* resolve /tm command conflict between skill and registerCommand ([2125ef7](https://github.com/jcoulaud/openclaw-telegram-manager/commit/2125ef709aa2a7fba6c1a31c3e3e82855b3266c2))

## [1.3.8](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.3.7...v1.3.8) (2026-02-12)


### Bug Fixes

* rename /topic to /tm to avoid Telegram native command conflict ([c58f824](https://github.com/jcoulaud/openclaw-telegram-manager/commit/c58f8246c73e0df46cca1fac3acd17aa9618f93d))
* update bug report template to use /tm command ([58d5fa5](https://github.com/jcoulaud/openclaw-telegram-manager/commit/58d5fa5d3518ea85bcd7fb527d82538fba3bbec2))

## [1.3.7](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.3.6...v1.3.7) (2026-02-12)


### Bug Fixes

* use registerCommand for /topic to receive message context ([e58c657](https://github.com/jcoulaud/openclaw-telegram-manager/commit/e58c657c426dc2c2a91f0291689fca941d443ad9))

## [1.3.6](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.3.5...v1.3.6) (2026-02-11)


### Bug Fixes

* use absolute path for skills.load.extraDirs in config ([4430db2](https://github.com/jcoulaud/openclaw-telegram-manager/commit/4430db2c1be2feab5224d5be152fea3290ec3040))

## [1.3.5](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.3.4...v1.3.5) (2026-02-11)


### Bug Fixes

* return tool result in AgentToolResult format and register skills dir ([97758c7](https://github.com/jcoulaud/openclaw-telegram-manager/commit/97758c7919ec1e1ccda97529263877a616fb495f))

## [1.3.4](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.3.3...v1.3.4) (2026-02-11)


### Bug Fixes

* restore inline groups in config on uninstall instead of deleting ([d73e406](https://github.com/jcoulaud/openclaw-telegram-manager/commit/d73e4068f103c673b752678469cbb0d3f90232fc))

## [1.3.3](https://github.com/jcoulaud/openclaw-telegram-manager/compare/v1.3.2...v1.3.3) (2026-02-11)


### Bug Fixes

* suppress false 'Gateway restarted' message on restart failure ([0a02839](https://github.com/jcoulaud/openclaw-telegram-manager/commit/0a02839d90942798f5919e68572b5de9dc4f78f2))

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
