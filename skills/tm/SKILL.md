---
name: tm
description: Manage Telegram topic persistent memory — call topic_manager after reset/compaction to rehydrate, and before long conversations to flush state
user-invocable: false
---

# Topic Manager

The `/tm` command is handled by the plugin's registerCommand handler.
This skill exists only to provide proactive model context.

## Proactive behavior (model-invocable)

If you detect any of these conditions, invoke `topic_manager` proactively:

1. **After /reset, /new, or context compaction**: call `topic_manager` with
   command "status" to re-read the topic files and rehydrate context.
   Rehydration order: STATUS.md, TODO.md, LEARNINGS.md (last 20 entries),
   COMMANDS.md, LINKS.md, then any overlay files present in the topic directory.
2. **Before context gets large**: proactively flush current progress to
   STATUS.md using the standard file write tool (update "Last done (UTC)"
   and "Next actions (now)"). Do NOT route this through /tm — write directly.
3. **When you notice a topic has no persistent memory**: suggest `/tm init`.
4. **When you discover something unexpected** (a mistake, workaround, or
   constraint): prepend a dated entry to LEARNINGS.md in the topic folder.
5. **When the user shares important project information** that would be needed
   after a session reset, persist it immediately to the appropriate topic file.
   Don't wait for the user to ask — this is the first context lost on reset.

   Examples by topic type:
   - **Coding**: repository paths, runtime/data paths, branch names, service URLs,
     environment details → LINKS.md, DEPLOY.md, ARCHITECTURE.md
   - **Research**: key sources, data locations, API endpoints, methodology decisions
     → SOURCES.md, LINKS.md, FINDINGS.md
   - **Marketing**: campaign URLs, analytics dashboards, social accounts, brand
     guidelines location → CAMPAIGNS.md, LINKS.md, METRICS.md
   - **General / any type**: reference URLs, contacts, key decisions, file paths
     → LINKS.md, NOTES.md

   Rule of thumb: if losing this information would cause the agent to make a
   wrong assumption after reset, it must be written down now.

## Autopilot context

Autopilot is enabled by default on setup and first-user init. The OpenClaw
heartbeat triggers `doctor --all` roughly once per hour, which health-checks
all active topics. Daily progress reports are posted by per-topic cron jobs
(registered on init, default 09:00 UTC). No manual intervention is needed.
Users can disable with `/tm autopilot disable`.

## Callback routing

If a message starts with `tm:`, pass the entire string as the `command`
argument to `topic_manager`. This routes inline keyboard callbacks
(e.g., `tm:snooze7d:-100123:456:...`) to the tool for verification and handling.

## Available sub-commands

init, doctor, doctor --all, status, list, sync, rename <name>,
upgrade, snooze <Nd>, archive, unarchive, autopilot [enable|disable|status],
daily-report, help
