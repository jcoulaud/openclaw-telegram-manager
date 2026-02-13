// ── Gateway cron job management via RPC ────────────────────────────────
//
// Creates isolated cron jobs for daily topic reports.
// Jobs run in fresh sessions and deliver output to the target Telegram topic.

import type { RpcInterface, Logger } from './types.js';

// ── Constants ──────────────────────────────────────────────────────────

export const DEFAULT_CRON_SCHEDULE = '0 9 * * *'; // 09:00 UTC daily
export const DEFAULT_CRON_TZ = 'UTC';

// ── Types ──────────────────────────────────────────────────────────────

export interface CronJobParams {
  topicName: string;
  slug: string;
  groupId: string;
  threadId: string;
  schedule?: string;
  tz?: string;
}

export interface CronAddResult {
  jobId: string | null;
  error?: string;
}

// ── Create a daily report cron job ─────────────────────────────────────

/**
 * Register a Gateway cron job for daily reports on a specific topic.
 *
 * The job runs in an isolated session and delivers a daily report
 * to the target Telegram topic.
 *
 * Returns the job ID on success, or null with error message on failure.
 * Non-critical — callers should log failures but not block on them.
 */
export async function registerDailyReportCron(
  rpc: RpcInterface | null | undefined,
  params: CronJobParams,
  logger: Logger,
): Promise<CronAddResult> {
  if (!rpc) {
    return { jobId: null, error: 'RPC not available' };
  }

  const { topicName, slug, groupId, threadId, schedule, tz } = params;
  const cronExpr = schedule ?? DEFAULT_CRON_SCHEDULE;
  const timezone = tz ?? DEFAULT_CRON_TZ;

  // Telegram topic target format: groupId:topic:threadId
  const telegramTarget = `${groupId}:topic:${threadId}`;

  try {
    const result = await rpc.call('cron.add', {
      name: `tm-daily-${slug}`,
      schedule: {
        kind: 'cron',
        expr: cronExpr,
        tz: timezone,
      },
      sessionTarget: 'isolated',
      wakeMode: 'now',
      payload: {
        kind: 'agentTurn',
        message: `Run topic_manager with command "daily-report" for the topic "${topicName}" (slug: ${slug}, group: ${groupId}, thread: ${threadId}). Post the report to this topic.`,
      },
      delivery: {
        mode: 'announce',
        channels: {
          telegram: {
            to: telegramTarget,
          },
        },
      },
    });

    const jobId = (result['jobId'] ?? result['id'] ?? null) as string | null;

    if (jobId) {
      logger.info(`[cron] Created daily report job "${jobId}" for ${slug} (${cronExpr} ${timezone})`);
      return { jobId };
    }

    return { jobId: null, error: 'Gateway did not return a job ID' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[cron] Failed to create daily report job for ${slug}: ${msg}`);
    return { jobId: null, error: msg };
  }
}

// ── Remove a cron job ──────────────────────────────────────────────────

/**
 * Remove a Gateway cron job by ID.
 *
 * Non-critical — callers should log failures but not block on them.
 */
export async function removeCronJob(
  rpc: RpcInterface | null | undefined,
  jobId: string,
  logger: Logger,
): Promise<boolean> {
  if (!rpc) {
    return false;
  }

  try {
    await rpc.call('cron.remove', { jobId });
    logger.info(`[cron] Removed cron job "${jobId}"`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[cron] Failed to remove cron job "${jobId}": ${msg}`);
    return false;
  }
}
