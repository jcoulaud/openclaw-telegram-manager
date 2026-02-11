# Contributing

Thanks for wanting to contribute! Here's what you need to know.

## Setup

```bash
git clone https://github.com/jcoulaud/openclaw-telegram-manager.git
cd openclaw-telegram-manager
npm install
```

Run the tests to make sure everything works:

```bash
npm test
```

Check for type errors:

```bash
npm run lint
```

## Making changes

**Branch naming** — prefix your branch with what it is:

- `feat/` for new features
- `fix/` for bug fixes
- `docs/` for documentation
- `refactor/` for refactoring
- `test/` for test changes
- `chore/` for maintenance stuff

**Code rules:**

- TypeScript strict mode, no `any` (except at the OpenClaw plugin API boundary)
- Generated config must use `JSON5.stringify()` — no string interpolation
- File writes go through write-to-temp-then-rename (atomic writes)
- All paths get resolved to absolute and checked against the workspace root
- User data in Telegram messages must be HTML-escaped
- A failing topic should never crash a batch operation

**Tests:**

- All `lib/` modules need unit tests
- New commands need at least a happy-path integration test
- Tests can't depend on network or a running OpenClaw instance
- Use mocks for filesystems and API calls

## Submitting a PR

1. Fork the repo, branch from `main`
2. Write or update tests for what you changed
3. Make sure `npm test` and `npm run lint` pass
4. Run `npm audit` — no new vulnerabilities
5. Add your changes to `CHANGELOG.md` under `[Unreleased]`
6. Open the PR with a clear title and fill out the template

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/) for automated releases. Always prefix with a type:

- `feat: add topic rename command`
- `fix: registry lock timeout on slow filesystems`
- `docs: update doctor check examples`
- `refactor: extract config writes helper`
- `test: add snooze duration edge cases`
- `chore: bump dependencies`

## Found a bug?

Use the [bug report template](https://github.com/jcoulaud/openclaw-telegram-manager/issues/new?template=bug_report.md). Include steps to reproduce.
