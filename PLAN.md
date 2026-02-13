# OpenClaw Telegram Manager — Determinism & Reliability Plan (v2)

## Goal

Each Telegram topic is a deterministic project capsule. After `/new`, `/reset`, or compaction, the assistant immediately knows what this topic is about, what was done, what's next, and what was learned — without mixing other topics.

## What's already shipped

The following are done and not revisited by this plan:

- Context hierarchy in system prompt (topic capsule > global memory > other topics blocked)
- Cross-topic guardrails via prompt-level instructions
- Deterministic rehydration order (STATUS.md → TODO.md → LEARNINGS.md → COMMANDS.md → LINKS.md)
- No-op capsule write guard (`writeCapsuleFileIfChanged`)
- `lastCapsuleWriteAt` + `lastDailyReportAt` in registry (v4)
- Dynamic `activityTier` computation
- Doctor-all fan-out with eligibility gating + UTC dedupe
- Doctor-triggered `.tm-backup/` snapshots
- First-user admin bootstrap + autopilot auto-enable

---

## Phase 1 — Post-failure correctness

**Goal:** Delivery failures are tracked and never silently swallowed.

### 1.1 Audit post-failure timestamp behavior

Verify that `lastDailyReportAt` is only updated after confirmed Telegram delivery. If it's set before the post call or set even when the post throws, fix the ordering.

### 1.2 Add `lastPostError` to registry

Add an optional `lastPostError: string | null` field to `TopicEntrySchema`. Set it to the error message on failed Telegram delivery, clear it to `null` on success. Surface it in `/tm doctor` as a WARN-level check ("Last report delivery failed: {reason}").

### 1.3 Registry migration

- Bump `CURRENT_REGISTRY_VERSION` (4 → 5)
- Migration: add `lastPostError: null` to each topic entry
- Update `SETUP_REGISTRY_VERSION` in `setup.ts`
- Update test fixtures

**Files:** `types.ts`, `registry.ts`, `setup.ts`, `doctor-checks.ts`, `doctor-all.ts`, test files

---

## Phase 2 — Standardize status output

**Goal:** `/tm status` always returns a consistent, scannable format.

### 2.1 Define the status contract

Five optional blocks, always in this order when present:

1. **Goal** — one-line topic purpose
2. **Current status** — what state the work is in
3. **Done recently** — last 3-5 completed items
4. **Next actions** — immediate next steps
5. **Blockers** — anything preventing progress

Blocks with no content are omitted (not shown as empty). Default is compact; add an `--expanded` flag for full detail.

### 2.2 Implement in status command

Refactor `handleStatus()` to assemble the response from these blocks. Both markdown and HTML renderers produce the same structure.

**Files:** `commands/status.ts`, `telegram.ts`, tests

---

## Phase 3 — Cron integration for daily reports

**Goal:** Replace heartbeat-driven daily reports with Gateway cron jobs for exact-time delivery.

### 3.1 Background

The OpenClaw Gateway has a built-in cron scheduler (`~/.openclaw/cron/`) that supports:

- 5-field cron expressions with IANA timezone
- Isolated sessions (fresh context per run)
- Telegram topic delivery (`-1001234567890:topic:123`)
- Persistent jobs that survive restarts
- Exponential retry backoff (30s → 1m → 5m → 15m → 60m)

This is the officially recommended approach for exact-time tasks (see docs.openclaw.ai/automation/cron-vs-heartbeat).

### 3.2 Add `cronJobId` to registry

Add an optional `cronJobId: string | null` field to `TopicEntrySchema`. This stores the Gateway cron job ID for this topic's daily report.

Registry migration (5 → 6): add `cronJobId: null` to each entry.

### 3.3 Register cron job during `/tm init`

When a topic is initialized:

1. Create a Gateway cron job via the SDK/API targeting the topic's Telegram thread
2. Default schedule: `0 9 * * *` UTC (configurable per topic later)
3. Job runs in isolated session with a lean payload: topic slug + report instruction
4. Store the returned job ID in `cronJobId`

When a topic is archived or deleted, remove the cron job.

### 3.4 Lean cron session payload

Cron-triggered report sessions should receive only:

- The target topic's capsule files (STATUS.md, TODO.md, LEARNINGS.md)
- The report generation instruction
- No other topic data, no full conversation history

### 3.5 Simplify doctor-all

Once cron handles daily report delivery:

- Remove daily report fan-out logic from `doctor --all`
- Doctor-all goes back to pure health checks
- `lastDailyReportAt` dedupe logic can be simplified (cron handles scheduling)
- Keep eligibility gating (archived/snoozed topics skip reports)

### 3.6 Trim daily report sections

Keep three sections in the Telegram message:

1. **Done** — what happened since last report
2. **Next** — immediate next steps
3. **Blockers** — anything stuck

Drop learnings, upcoming, and health from the daily message. These live in capsule files for the assistant to read, not for the user to receive daily.

**Files:** `types.ts`, `registry.ts`, `setup.ts`, `commands/init.ts`, `commands/doctor-all.ts`, `daily-report.ts`, `include-generator.ts`, tests

---

## Phase 4 — Failure edge case tests

**Goal:** Cover the edge cases that matter for reliability.

### Tests to add

1. **Failed post doesn't update `lastDailyReportAt`** — mock a Telegram post failure, verify timestamp unchanged
2. **Failed post sets `lastPostError`** — verify error message stored
3. **Successful post clears `lastPostError`** — verify reset to null
4. **Partial fan-out failure** — one topic's post fails, others succeed, verify per-topic tracking
5. **Cron job registration on init** — verify `cronJobId` stored
6. **Cron job cleanup on archive** — verify job removed
7. **Status output contains required blocks** — verify structure for various topic states

**Files:** `tests/commands/doctor-all.test.ts`, `tests/commands/init.test.ts`, `tests/commands/status.test.ts`, `tests/daily-report.test.ts`

---

## Deliberately excluded

| Proposal | Reason for exclusion |
|----------|---------------------|
| `dirtyFlags` + milestone engine | Plugin executes per-command; no dirty state between invocations |
| Debounce + checkpoint window | No persistent process to debounce across |
| `msgCount24h` | Plugin only sees `/tm` invocations, not all topic messages |
| Runtime cross-topic detector | Plugin sees one message at a time; prompt-level guard is correct approach |
| "No major changes" quiet mode | Premature — short reports are already short |
| CRON.md per topic | Redundant with `cronJobId` in registry + Gateway's `jobs.json` |
| Persist `activityTier` in registry | Not needed until cron frequency varies by tier; revisit then |

---

## Execution order

| PR | Phase | Scope |
|----|-------|-------|
| 1 | Phase 1 | `lastPostError` field, timestamp audit, migration 4→5, doctor check |
| 2 | Phase 2 | Standardized status output, `--expanded` flag |
| 3 | Phase 3.2-3.3 | `cronJobId` field, migration 5→6, cron registration in init |
| 4 | Phase 3.4-3.6 | Lean cron payload, doctor-all simplification, report trimming |
| 5 | Phase 4 | Failure edge case tests |

PRs 1 and 2 are independent and can be done in parallel.
PR 3 depends on PR 1 (registry migration sequencing).
PR 4 depends on PR 3.
PR 5 can start after PR 1 and grow incrementally with each subsequent PR.
