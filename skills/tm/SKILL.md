---
name: tm
description: Manage Telegram topics as deterministic workcells with durable capsule state
user-invocable: false
---

# Topic Manager

The `/tm` command is handled by the plugin's registerCommand handler.
This skill exists only to provide proactive model context.

## Proactive behavior (model-invocable)

If you detect any of these conditions, invoke `topic_manager` proactively:

1. **After /reset, /new, or context compaction**: call `topic_manager` with
   command "status" to re-read the capsule and rehydrate context.
2. **Before context gets large**: proactively flush current progress to
   STATUS.md using the standard file write tool (update "Last done (UTC)"
   and "Next 3 actions"). Do NOT route this through /tm — write directly.
3. **When you notice a topic has no capsule**: suggest `/tm init`.

## Callback routing

If a message starts with `tm:`, pass the entire string as the `command`
argument to `topic_manager`. This routes inline keyboard callbacks
(e.g., `tm:snooze7d:my-topic:...`) to the tool for verification and handling.

## Available sub-commands

init, doctor, doctor --all, status, list, sync, rename <slug>,
upgrade, snooze <Nd>, archive, unarchive, help
