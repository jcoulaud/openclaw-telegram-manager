import * as path from 'node:path';
import { readRegistry, withRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import {
  INACTIVE_AFTER_DAYS,
  MAX_POST_ERROR_LENGTH,
} from '../lib/types.js';
import type { TopicEntry } from '../lib/types.js';
import { buildDailyReport, createRateLimitedPoster, truncateMessage } from '../lib/telegram.js';
import { mostRecent, extractStatusTimestamp } from './doctor-all.js';
import {
  readFileOrNull,
  extractDoneSection,
  extractBlockers,
  extractNextActions,
} from './daily-report.js';
import type { CommandContext, CommandResult } from './help.js';

// ── Per-topic outcome tracking ───────────────────────────────────────

export type DailyReportSkipReason = 'archived' | 'snoozed' | 'inactive' | 'already-reported-today';

export interface DailyReportEligibilityResult {
  eligible: boolean;
  skipReason?: DailyReportSkipReason;
}

interface TopicOutcome {
  name: string;
  slug: string;
  status: 'reported' | 'post-failed';
}

interface SkippedTopic {
  name: string;
  reason: DailyReportSkipReason;
}

// ── Eligibility ──────────────────────────────────────────────────────

export function getDailyReportEligibility(
  entry: TopicEntry,
  now: Date,
  statusTimestamp?: string | null,
): DailyReportEligibilityResult {
  if (entry.status === 'archived') return { eligible: false, skipReason: 'archived' };

  if (entry.snoozeUntil && new Date(entry.snoozeUntil).getTime() > now.getTime()) {
    return { eligible: false, skipReason: 'snoozed' };
  }

  const lastActive = mostRecent(entry.lastMessageAt, statusTimestamp);
  if (lastActive) {
    const lastActiveMs = new Date(lastActive).getTime();
    const inactiveMs = INACTIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    if (now.getTime() - lastActiveMs > inactiveMs) {
      return { eligible: false, skipReason: 'inactive' };
    }
  }

  // Calendar-day dedup (UTC)
  if (entry.lastDailyReportAt) {
    const lastReport = new Date(entry.lastDailyReportAt);
    if (
      lastReport.getUTCFullYear() === now.getUTCFullYear() &&
      lastReport.getUTCMonth() === now.getUTCMonth() &&
      lastReport.getUTCDate() === now.getUTCDate()
    ) {
      return { eligible: false, skipReason: 'already-reported-today' };
    }
  }

  return { eligible: true };
}

// ── Summary builder ──────────────────────────────────────────────────

const SKIP_ICONS: Record<DailyReportSkipReason, string> = {
  archived: '\ud83d\udce6',              // 📦
  snoozed: '\ud83d\udca4',               // 💤
  inactive: '\ud83d\udd07',              // 🔇
  'already-reported-today': '\u23f0',     // ⏰
};

const SKIP_LABELS: Record<DailyReportSkipReason, string> = {
  archived: 'archived',
  snoozed: 'snoozed',
  inactive: 'inactive',
  'already-reported-today': 'already reported today',
};

export interface DailyReportAllSummaryData {
  reportedTopics: TopicOutcome[];
  skippedTopics: SkippedTopic[];
  postFailures: number;
  migrationGroups: number;
  errors: string[];
}

const SUMMARY_SOFT_LIMIT = 3800;

export function buildDailyReportAllSummary(data: DailyReportAllSummaryData): string {
  const {
    reportedTopics,
    skippedTopics,
    postFailures,
    migrationGroups,
    errors,
  } = data;

  if (reportedTopics.length === 0 && skippedTopics.length === 0) {
    return '**Daily Report Summary**\n\nNo topics registered yet.';
  }

  const lines: string[] = ['**Daily Report Summary**', ''];

  // ── Reported topics ──
  let renderedCount = 0;
  for (const t of reportedTopics) {
    let icon: string;
    let label: string;
    switch (t.status) {
      case 'reported':
        icon = '\u2705'; // ✅
        label = 'reported';
        break;
      case 'post-failed':
        icon = '\u26a0\ufe0f'; // ⚠️
        label = 'failed to post';
        break;
    }
    const line = `${icon} ${t.name} \u2014 ${label}`;
    if (lines.join('\n').length + line.length > SUMMARY_SOFT_LIMIT) {
      const remaining = reportedTopics.length - renderedCount;
      lines.push(`... and ${remaining} more`);
      break;
    }
    lines.push(line);
    renderedCount++;
  }

  // ── Skipped topics ──
  if (skippedTopics.length > 0) {
    lines.push('');
    lines.push('\u23ed\ufe0f Skipped:'); // ⏭️
    let skippedRendered = 0;
    for (const t of skippedTopics) {
      const icon = SKIP_ICONS[t.reason];
      const label = SKIP_LABELS[t.reason];
      const line = `${icon} ${t.name} \u2014 ${label}`;
      if (lines.join('\n').length + line.length > SUMMARY_SOFT_LIMIT) {
        const remaining = skippedTopics.length - skippedRendered;
        lines.push(`... and ${remaining} more`);
        break;
      }
      lines.push(line);
      skippedRendered++;
    }
  }

  // ── Post failures callout ──
  if (postFailures > 0) {
    lines.push('');
    lines.push(`\u26a0\ufe0f ${postFailures} topic(s) failed to post`);
  }

  // ── Migration warning ──
  if (migrationGroups > 0) {
    lines.push('');
    lines.push(`**Warning:** ${migrationGroups} group(s) had all topics fail. The group may have been migrated or deleted.`);
  }

  // ── Errors (internal) ──
  if (errors.length > 0) {
    lines.push('');
    lines.push(`**Errors (${errors.length}):**`);
    for (const e of errors.slice(0, 10)) {
      lines.push(`- ${e}`);
    }
    if (errors.length > 10) {
      lines.push(`... and ${errors.length - 10} more`);
    }
  }

  return truncateMessage(lines.join('\n'));
}

// ── Main handler ─────────────────────────────────────────────────────

export async function handleDailyReportAll(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir, logger } = ctx;

  const registry = readRegistry(workspaceDir);

  // Autopilot calls have no Telegram user context — fall back to first admin
  const userId = ctx.userId ?? registry.topicManagerAdmins[0];
  if (!userId) {
    return { text: 'Something went wrong — could not identify your user account.' };
  }

  // Auth check (admin tier)
  const auth = checkAuthorization(userId, 'daily-report-all', registry);
  if (!auth.authorized) {
    return { text: auth.message ?? 'Not authorized.' };
  }

  const now = new Date();
  const projectsBase = path.join(workspaceDir, 'projects');

  const allEntries = Object.entries(registry.topics);
  const reportedTopics: TopicOutcome[] = [];
  const skippedTopics: SkippedTopic[] = [];
  const errors: string[] = [];

  // Group tracking for migration detection
  const groupPostResults = new Map<string, { total: number; failed: number }>();

  interface TopicReport {
    slug: string;
    groupId: string;
    threadId: string;
    text: string;
  }

  const reports: TopicReport[] = [];

  for (const [_key, entry] of allEntries) {
    const capsuleDir = path.join(projectsBase, entry.slug);
    const statusContent = readFileOrNull(path.join(capsuleDir, 'STATUS.md'));
    const statusTs = statusContent ? extractStatusTimestamp(statusContent) : null;
    const eligibility = getDailyReportEligibility(entry, now, statusTs);

    if (!eligibility.eligible) {
      skippedTopics.push({ name: entry.name, reason: eligibility.skipReason! });
      continue;
    }

    try {
      const doneContent = extractDoneSection(statusContent);
      const blockers = extractBlockers(statusContent);
      const nextContent = extractNextActions(statusContent);

      const reportData = {
        name: entry.name,
        doneContent,
        blockersContent: blockers,
        nextContent,
      };

      const reportText = buildDailyReport(reportData, 'html');

      reports.push({
        slug: entry.slug,
        groupId: entry.groupId,
        threadId: entry.threadId,
        text: reportText,
      });

      // Track group post results for migration detection
      const gk = entry.groupId;
      if (!groupPostResults.has(gk)) {
        groupPostResults.set(gk, { total: 0, failed: 0 });
      }
      groupPostResults.get(gk)!.total++;

      reportedTopics.push({ name: entry.name, slug: entry.slug, status: 'reported' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${entry.slug}: ${msg}`);
      logger.error(`[daily-report-all] Error processing ${entry.slug}: ${msg}`);

      const gk = entry.groupId;
      if (!groupPostResults.has(gk)) {
        groupPostResults.set(gk, { total: 0, failed: 0 });
      }
      groupPostResults.get(gk)!.total++;
      groupPostResults.get(gk)!.failed++;
    }
  }

  // Migration detection: all topics in a group failed
  const migrationGroups: string[] = [];
  for (const [gid, stats] of groupPostResults) {
    if (stats.total > 0 && stats.failed === stats.total) {
      migrationGroups.push(gid);
    }
  }

  // Fan-out posting
  let postFailures = 0;
  const postFailedSlugs = new Set<string>();

  if (ctx.postFn && reports.length > 0) {
    const rateLimitedPost = createRateLimitedPoster(ctx.postFn);

    for (const report of reports) {
      try {
        await rateLimitedPost(report.groupId, report.threadId, report.text);

        await withRegistry(workspaceDir, (data) => {
          const key = `${report.groupId}:${report.threadId}`;
          const entry = data.topics[key];
          if (entry) {
            entry.lastDailyReportAt = now.toISOString();
            entry.lastPostError = null;
          }
        });
      } catch (err) {
        postFailures++;
        postFailedSlugs.add(report.slug);
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[daily-report-all] Post failed for ${report.slug}: ${msg}`);

        await withRegistry(workspaceDir, (data) => {
          const key = `${report.groupId}:${report.threadId}`;
          const entry = data.topics[key];
          if (entry) {
            entry.lastPostError = msg.slice(0, MAX_POST_ERROR_LENGTH);
          }
        });
      }
    }

    // Update outcomes for post-failed topics
    for (const outcome of reportedTopics) {
      if (postFailedSlugs.has(outcome.slug) && outcome.status === 'reported') {
        outcome.status = 'post-failed';
      }
    }
  } else if (reports.length > 0) {
    // No postFn — still update lastDailyReportAt
    await withRegistry(workspaceDir, (data) => {
      for (const report of reports) {
        const key = `${report.groupId}:${report.threadId}`;
        const entry = data.topics[key];
        if (entry) {
          entry.lastDailyReportAt = now.toISOString();
        }
      }
    });
  }

  return {
    text: buildDailyReportAllSummary({
      reportedTopics,
      skippedTopics,
      postFailures,
      migrationGroups: migrationGroups.length,
      errors,
    }),
  };
}
