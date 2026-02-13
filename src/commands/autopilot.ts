import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRegistry, withRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import { relativeTime } from '../lib/telegram.js';
import type { CommandContext, CommandResult } from './help.js';

// ── Marker constants ────────────────────────────────────────────────

const MARKER_START = '<!-- TM_AUTOPILOT_START -->';
const MARKER_END = '<!-- TM_AUTOPILOT_END -->';

const HEARTBEAT_BLOCK = `${MARKER_START}
## Topic Manager — Balanced Autopilot

Execute these steps IN ORDER. Do not skip steps.

1. CALL \`topic_manager\` with command "doctor --all" to health-check all active topics.
   This handles stale timestamps, task ID mismatches, and posting errors automatically.
2. For each topic where STATUS.md "Last done (UTC)" is >3 days old:
   post a brief nudge in that topic asking the user for a status update.
3. If no actions were taken in steps 1-2, do nothing (HEARTBEAT_OK).
${MARKER_END}`;

const HEARTBEAT_FILENAME = 'HEARTBEAT.md';

// ── Main handler ────────────────────────────────────────────────────

export async function handleAutopilot(ctx: CommandContext, args: string): Promise<CommandResult> {
  const { workspaceDir, userId } = ctx;

  if (!userId) {
    return { text: 'Missing context: userId not available.' };
  }

  const registry = readRegistry(workspaceDir);

  const auth = checkAuthorization(userId, 'autopilot', registry);
  if (!auth.authorized) {
    return { text: auth.message ?? 'Not authorized.' };
  }

  const subCommand = args.trim().toLowerCase() || 'enable';

  switch (subCommand) {
    case 'enable':
      return handleEnable(ctx);
    case 'disable':
      return handleDisable(ctx);
    case 'status':
      return handleStatus(ctx);
    default:
      return { text: `Unknown autopilot sub-command: "${subCommand}". Use enable, disable, or status.` };
  }
}

// ── Enable ──────────────────────────────────────────────────────────

async function handleEnable(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir } = ctx;
  const heartbeatPath = path.join(workspaceDir, HEARTBEAT_FILENAME);

  // Read or create HEARTBEAT.md
  let content = '';
  try {
    if (fs.existsSync(heartbeatPath)) {
      content = fs.readFileSync(heartbeatPath, 'utf-8');
    }
  } catch {
    // File doesn't exist yet — that's fine
  }

  // Idempotent: don't duplicate if marker already present
  if (content.includes(MARKER_START)) {
    // Update registry flag anyway in case it's out of sync
    await withRegistry(workspaceDir, (data) => {
      data.autopilotEnabled = true;
    });
    return { text: 'Autopilot is already enabled.' };
  }

  // Append block to HEARTBEAT.md
  const newContent = content ? content.trimEnd() + '\n\n' + HEARTBEAT_BLOCK + '\n' : HEARTBEAT_BLOCK + '\n';
  fs.writeFileSync(heartbeatPath, newContent, { mode: 0o640 });

  await withRegistry(workspaceDir, (data) => {
    data.autopilotEnabled = true;
  });

  return {
    text: '**Autopilot enabled.**\nHealth checks will run automatically every day.',
  };
}

// ── Disable ─────────────────────────────────────────────────────────

async function handleDisable(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir } = ctx;
  const heartbeatPath = path.join(workspaceDir, HEARTBEAT_FILENAME);

  if (!fs.existsSync(heartbeatPath)) {
    await withRegistry(workspaceDir, (data) => {
      data.autopilotEnabled = false;
    });
    return { text: 'Autopilot is already disabled.' };
  }

  let content = fs.readFileSync(heartbeatPath, 'utf-8');

  if (!content.includes(MARKER_START)) {
    await withRegistry(workspaceDir, (data) => {
      data.autopilotEnabled = false;
    });
    return { text: 'Autopilot is already disabled.' };
  }

  // Remove everything between markers (inclusive)
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);

  if (startIdx >= 0 && endIdx >= 0) {
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + MARKER_END.length);
    content = (before + after).replace(/\n{3,}/g, '\n\n').trim();

    if (content) {
      fs.writeFileSync(heartbeatPath, content + '\n', { mode: 0o640 });
    } else {
      fs.unlinkSync(heartbeatPath);
    }
  }

  await withRegistry(workspaceDir, (data) => {
    data.autopilotEnabled = false;
  });

  return {
    text: '**Autopilot disabled.**\nAutomatic health checks are now off.',
  };
}

// ── Status ──────────────────────────────────────────────────────────

async function handleStatus(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir } = ctx;
  const registry = readRegistry(workspaceDir);

  const enabled = registry.autopilotEnabled;
  const lastRun = registry.lastDoctorAllRunAt
    ? relativeTime(registry.lastDoctorAllRunAt)
    : 'never';

  const lines = [
    `**Autopilot:** ${enabled ? 'enabled' : 'disabled'}`,
    `**Last health check run:** ${lastRun}`,
  ];

  return {
    text: lines.join('\n'),
  };
}
