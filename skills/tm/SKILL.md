---
name: tm
description: Manage Telegram topic capsules — call topic_manager after reset/compaction to rehydrate, and before long conversations to flush state
user-invocable: false
---

# Topic Manager

The `/tm` command is handled by the plugin's registerCommand handler.
This skill exists only to provide proactive model context.

## Proactive behavior (model-invocable)

If you detect any of these conditions, invoke `topic_manager` proactively:

1. **After /reset, /new, or context compaction**: call `topic_manager` with
   command "status" to re-read the capsule and rehydrate context.
   Rehydration order: STATUS.md, TODO.md, LEARNINGS.md (last 20 entries),
   then COMMANDS.md.
2. **Before context gets large**: proactively flush current progress to
   STATUS.md using the standard file write tool (update "Last done (UTC)"
   and "Next actions (now)"). Do NOT route this through /tm — write directly.
3. **When you notice a topic has no capsule**: suggest `/tm init`.
4. **When you discover something unexpected** (a mistake, workaround, or
   constraint): prepend a dated entry to LEARNINGS.md in the capsule.

## Autopilot context

When autopilot is enabled (`/tm autopilot enable`), a daily health sweep
runs via the OpenClaw heartbeat. The heartbeat triggers `doctor --all`,
which checks all active topics and posts individual reports. No manual
intervention is needed once enabled.

## Callback routing

If a message starts with `tm:`, pass the entire string as the `command`
argument to `topic_manager`. This routes inline keyboard callbacks
(e.g., `tm:snooze7d:-100123:456:...`) to the tool for verification and handling.

## Available sub-commands

init, doctor, doctor --all, status, list, sync, rename <name>,
upgrade, snooze <Nd>, archive, unarchive, autopilot [enable|disable|status],
daily-report, help
