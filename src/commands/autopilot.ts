import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRegistry, withRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import { relativeTime } from '../lib/telegram.js';
import { registerCombinedCron, removeCronJob } from '../lib/cron.js';
import type { CommandContext, CommandResult } from './help.js';

// ── Marker constants ────────────────────────────────────────────────

export const MARKER_START = '<!-- TM_AUTOPILOT_START -->';
export const MARKER_END = '<!-- TM_AUTOPILOT_END -->';

export const HEARTBEAT_BLOCK = `${MARKER_START}
## Topic Manager — Balanced Autopilot

Daily reports and health checks are handled by the cron scheduler.
No action needed here (HEARTBEAT_OK).
${MARKER_END}`;

export const HEARTBEAT_FILENAME = 'HEARTBEAT.md';

// ── Main handler ────────────────────────────────────────────────────

export async function handleAutopilot(ctx: CommandContext, args: string): Promise<CommandResult> {
  const { workspaceDir, userId } = ctx;

  if (!userId) {
    return { text: 'Something went wrong — could not identify your user account.' };
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
  const { workspaceDir, rpc, logger } = ctx;
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

    // Ensure combined cron is registered
    await ensureCombinedCron(workspaceDir, rpc, logger);

    return { text: 'Autopilot is already enabled.' };
  }

  // Append block to HEARTBEAT.md
  const newContent = content ? content.trimEnd() + '\n\n' + HEARTBEAT_BLOCK + '\n' : HEARTBEAT_BLOCK + '\n';
  fs.writeFileSync(heartbeatPath, newContent, { mode: 0o640 });

  await withRegistry(workspaceDir, (data) => {
    data.autopilotEnabled = true;
  });

  // Register combined cron + cleanup per-topic crons
  await ensureCombinedCron(workspaceDir, rpc, logger);
  await cleanupPerTopicCrons(workspaceDir, rpc, logger);

  return {
    text: '**Autopilot enabled.**\nDaily reports and health checks will run automatically at 09:00 UTC.',
  };
}

// ── Disable ─────────────────────────────────────────────────────────

async function handleDisable(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir, rpc, logger } = ctx;
  const heartbeatPath = path.join(workspaceDir, HEARTBEAT_FILENAME);

  if (!fs.existsSync(heartbeatPath)) {
    await removeCombinedCron(workspaceDir, rpc, logger);
    await withRegistry(workspaceDir, (data) => {
      data.autopilotEnabled = false;
    });
    return { text: 'Autopilot is already disabled.' };
  }

  let content = fs.readFileSync(heartbeatPath, 'utf-8');

  if (!content.includes(MARKER_START)) {
    await removeCombinedCron(workspaceDir, rpc, logger);
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

  // Remove combined cron
  await removeCombinedCron(workspaceDir, rpc, logger);

  await withRegistry(workspaceDir, (data) => {
    data.autopilotEnabled = false;
  });

  return {
    text: '**Autopilot disabled.**\nAutomatic daily reports and health checks are now off.',
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

  const cronStatus = registry.dailyReportCronJobId
    ? 'active (09:00 UTC)'
    : 'not registered';

  const lines = [
    `**Autopilot:** ${enabled ? 'enabled' : 'disabled'}`,
    `**Daily cron:** ${cronStatus}`,
    `**Last health check run:** ${lastRun}`,
  ];

  return {
    text: lines.join('\n'),
  };
}

// ── Cron helpers ──────────────────────────────────────────────────────

import type { RpcInterface, Logger } from '../lib/types.js';

/**
 * Register the combined daily cron job if not already registered.
 * Stores the job ID in the registry's `dailyReportCronJobId`.
 */
export async function ensureCombinedCron(
  workspaceDir: string,
  rpc: RpcInterface | null | undefined,
  logger: Logger,
): Promise<void> {
  const registry = readRegistry(workspaceDir);
  if (registry.dailyReportCronJobId) return;

  const result = await registerCombinedCron(rpc, logger);
  if (result.jobId) {
    await withRegistry(workspaceDir, (data) => {
      data.dailyReportCronJobId = result.jobId;
    });
  }
}

/**
 * Remove the combined daily cron job and clear the registry field.
 */
async function removeCombinedCron(
  workspaceDir: string,
  rpc: RpcInterface | null | undefined,
  logger: Logger,
): Promise<void> {
  const registry = readRegistry(workspaceDir);
  if (!registry.dailyReportCronJobId) return;

  await removeCronJob(rpc, registry.dailyReportCronJobId, logger);
  await withRegistry(workspaceDir, (data) => {
    data.dailyReportCronJobId = null;
  });
}

/**
 * Remove all per-topic cron jobs and clear their cronJobId fields.
 */
export async function cleanupPerTopicCrons(
  workspaceDir: string,
  rpc: RpcInterface | null | undefined,
  logger: Logger,
): Promise<void> {
  const registry = readRegistry(workspaceDir);
  const topicsWithCron = Object.entries(registry.topics)
    .filter(([, entry]) => entry.cronJobId !== null);

  if (topicsWithCron.length === 0) return;

  for (const [, entry] of topicsWithCron) {
    if (entry.cronJobId) {
      await removeCronJob(rpc, entry.cronJobId, logger);
    }
  }

  await withRegistry(workspaceDir, (data) => {
    for (const [key] of topicsWithCron) {
      const entry = data.topics[key];
      if (entry) {
        entry.cronJobId = null;
      }
    }
  });
}
