import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRegistry, withRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import {
  DOCTOR_ALL_COOLDOWN_MS,
  DOCTOR_PER_TOPIC_CAP_MS,
  INACTIVE_AFTER_DAYS,
  MAX_POST_ERROR_LENGTH,
  SPAM_THRESHOLD,
} from '../lib/types.js';
import type { TopicEntry, InlineKeyboardMarkup } from '../lib/types.js';
import { buildDoctorReport, buildDoctorButtons, buildDailyReport, createRateLimitedPoster } from '../lib/telegram.js';
import { runAllChecksForTopic, backupCapsuleIfHealthy } from '../lib/doctor-checks.js';
import { includePath } from '../lib/include-generator.js';
import {
  readFileOrNull,
  extractDoneSection,
  extractTodayLearnings,
  extractBlockers,
  extractNextActions,
  extractUpcoming,
  computeHealth,
} from './daily-report.js';
import type { CommandContext, CommandResult } from './help.js';

interface TopicReport {
  slug: string;
  groupId: string;
  threadId: string;
  text: string;
  keyboard: InlineKeyboardMarkup;
  error?: string;
}

export async function handleDoctorAll(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir, configDir, userId, logger } = ctx;

  if (!userId) {
    return { text: 'Something went wrong — could not identify your user account.' };
  }

  const registry = readRegistry(workspaceDir);

  // Auth check (admin tier)
  const auth = checkAuthorization(userId, 'doctor-all', registry);
  if (!auth.authorized) {
    return { text: auth.message ?? 'Not authorized.' };
  }

  // Global cooldown check
  if (registry.lastDoctorAllRunAt) {
    const lastRun = new Date(registry.lastDoctorAllRunAt).getTime();
    const elapsed = Date.now() - lastRun;
    if (elapsed < DOCTOR_ALL_COOLDOWN_MS) {
      const remainingMin = Math.ceil((DOCTOR_ALL_COOLDOWN_MS - elapsed) / 60_000);
      return {
        text: `Health checks were run ${Math.floor(elapsed / 60_000)} minutes ago. Try again in ${remainingMin} minute(s).`,
      };
    }
  }

  const now = new Date();
  const projectsBase = path.join(workspaceDir, 'projects');

  // Read include content for config checks (optional)
  let includeContent: string | undefined;
  const incPath = includePath(configDir);
  try {
    if (fs.existsSync(incPath)) {
      includeContent = fs.readFileSync(incPath, 'utf-8');
    }
  } catch {
    // Not critical
  }

  const cronJobsPath = path.join(configDir, 'cron', 'jobs.json');
  const allEntries = Object.entries(registry.topics);
  const reports: TopicReport[] = [];
  const errors: string[] = [];
  let processed = 0;
  let skipped = 0;

  // Group tracking for migration detection
  const groupPostResults = new Map<string, { total: number; failed: number }>();

  for (const [_key, entry] of allEntries) {
    // Eligibility gating
    if (!isEligible(entry, now)) {
      skipped++;
      continue;
    }

    try {
      const results = runAllChecksForTopic(
        entry,
        projectsBase,
        includeContent,
        registry,
        cronJobsPath,
      );

      // Spam control: auto-snooze if threshold reached
      const isSpam = entry.consecutiveSilentDoctors >= SPAM_THRESHOLD;
      if (isSpam) {
        // Auto-snooze is handled via the check result; we just note it
        logger.info(`[doctor-all] Auto-snoozing ${entry.slug} (${entry.consecutiveSilentDoctors} silent runs)`);
      }

      // Backup if healthy
      backupCapsuleIfHealthy(projectsBase, entry.slug, results);

      const reportText = buildDoctorReport(entry.name, results, 'html');
      const keyboard = buildDoctorButtons(
        entry.groupId,
        entry.threadId,
        registry.callbackSecret,
        userId,
      );

      reports.push({
        slug: entry.slug,
        groupId: entry.groupId,
        threadId: entry.threadId,
        text: reportText,
        keyboard,
      });

      // Track group post results for migration detection
      const gk = entry.groupId;
      if (!groupPostResults.has(gk)) {
        groupPostResults.set(gk, { total: 0, failed: 0 });
      }
      const group = groupPostResults.get(gk)!;
      group.total++;

      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${entry.slug}: ${msg}`);
      logger.error(`[doctor-all] Error processing ${entry.slug}: ${msg}`);

      // Track failures for migration detection
      const gk = entry.groupId;
      if (!groupPostResults.has(gk)) {
        groupPostResults.set(gk, { total: 0, failed: 0 });
      }
      const group = groupPostResults.get(gk)!;
      group.total++;
      group.failed++;
    }
  }

  // Migration detection: all topics in a group failed
  const migrationGroups: string[] = [];
  for (const [gid, stats] of groupPostResults) {
    if (stats.total > 0 && stats.failed === stats.total) {
      migrationGroups.push(gid);
    }
  }

  // Fan-out posting: post individual reports to each topic if postFn is available
  let postErrors = 0;
  let postSuccesses = 0;

  if (ctx.postFn && reports.length > 0) {
    const rateLimitedPost = createRateLimitedPoster(ctx.postFn);

    for (const report of reports) {
      try {
        await rateLimitedPost(report.groupId, report.threadId, report.text, report.keyboard);
        postSuccesses++;

        // Update lastDoctorReportAt transactionally on success
        await withRegistry(workspaceDir, (data) => {
          const key = `${report.groupId}:${report.threadId}`;
          const entry = data.topics[key];
          if (entry) {
            entry.lastDoctorReportAt = now.toISOString();
            entry.lastPostError = null;
          }
        });
      } catch (err) {
        postErrors++;
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[doctor-all] Post failed for ${report.slug}: ${msg}`);

        // Store error on topic entry
        await withRegistry(workspaceDir, (data) => {
          const key = `${report.groupId}:${report.threadId}`;
          const entry = data.topics[key];
          if (entry) {
            entry.lastPostError = msg.slice(0, MAX_POST_ERROR_LENGTH);
          }
        });
      }
    }
  }

  // Daily report fan-out: generate and post daily reports for eligible topics
  let dailyReportSuccesses = 0;
  let dailyReportSkipped = 0;
  const dailyReportKeys = new Set<string>();

  if (ctx.postFn && reports.length > 0) {
    const rateLimitedPost = createRateLimitedPoster(ctx.postFn);
    const nowDate = now.toISOString().slice(0, 10);

    for (const report of reports) {
      const key = `${report.groupId}:${report.threadId}`;
      const entry = registry.topics[key];
      if (!entry) continue;

      // Dedup: skip if already reported today
      if (entry.lastDailyReportAt) {
        const lastReport = new Date(entry.lastDailyReportAt);
        const lastDate = `${lastReport.getUTCFullYear()}-${String(lastReport.getUTCMonth() + 1).padStart(2, '0')}-${String(lastReport.getUTCDate()).padStart(2, '0')}`;
        if (lastDate === nowDate) {
          dailyReportSkipped++;
          continue;
        }
      }

      // Read capsule files
      const capsuleDir = path.join(projectsBase, entry.slug);
      const statusContent = readFileOrNull(path.join(capsuleDir, 'STATUS.md'));
      const todoContent = readFileOrNull(path.join(capsuleDir, 'TODO.md'));
      const learningsContent = readFileOrNull(path.join(capsuleDir, 'LEARNINGS.md'));

      // Extract sections
      const doneContent = extractDoneSection(statusContent);
      const newLearnings = extractTodayLearnings(learningsContent);
      const blockers = extractBlockers(todoContent);
      const nextContent = extractNextActions(statusContent);
      const upcomingContent = extractUpcoming(statusContent);
      const health = computeHealth(entry.lastMessageAt, statusContent, blockers);

      const reportData = {
        name: entry.name,
        doneContent,
        learningsContent: newLearnings,
        blockersContent: blockers,
        nextContent,
        upcomingContent,
        health,
      };

      try {
        const htmlReport = buildDailyReport(reportData, 'html');
        await rateLimitedPost(report.groupId, report.threadId, htmlReport);
        dailyReportSuccesses++;
        dailyReportKeys.add(key);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[doctor-all] Daily report post failed for ${entry.slug}: ${msg}`);
        // Daily report failures don't fail the overall run
      }
    }
  }

  // Update registry: lastDoctorAllRunAt, per-topic timestamps, and daily report timestamps
  await withRegistry(workspaceDir, (data) => {
    data.lastDoctorAllRunAt = now.toISOString();

    for (const [_key, entry] of Object.entries(data.topics)) {
      if (!isEligible(entry, now)) continue;

      // Update consecutiveSilentDoctors (compare against old lastDoctorRunAt before overwriting)
      if (entry.lastMessageAt) {
        const lastMsg = new Date(entry.lastMessageAt).getTime();
        const lastDoctor = entry.lastDoctorRunAt
          ? new Date(entry.lastDoctorRunAt).getTime()
          : 0;

        if (lastMsg > lastDoctor) {
          // User interacted since last doctor run — reset counter
          entry.consecutiveSilentDoctors = 0;
        } else {
          entry.consecutiveSilentDoctors++;
        }
      } else {
        entry.consecutiveSilentDoctors++;
      }

      entry.lastDoctorRunAt = now.toISOString();

      // Auto-snooze for spam control
      if (entry.consecutiveSilentDoctors >= SPAM_THRESHOLD) {
        entry.snoozeUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        entry.status = 'snoozed';
        entry.consecutiveSilentDoctors = 0;
      }
    }

    // Batch-update lastDailyReportAt for successful daily reports
    for (const key of dailyReportKeys) {
      const entry = data.topics[key];
      if (entry) {
        entry.lastDailyReportAt = now.toISOString();
      }
    }
  });

  // Build summary
  const lines: string[] = [
    `**Health Check Summary**`,
    '',
    `Checked: ${processed}`,
    `Skipped: ${skipped}`,
    `Total topics: ${allEntries.length}`,
  ];

  if (ctx.postFn) {
    lines.push(`Posted: ${postSuccesses}, Post failures: ${postErrors}`);
    lines.push(`Daily reports: ${dailyReportSuccesses} sent, ${dailyReportSkipped} skipped`);
  }

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

  if (migrationGroups.length > 0) {
    lines.push('');
    lines.push(`**Warning:** ${migrationGroups.length} group(s) had all topics fail. The group may have been migrated or deleted.`);
  }

  return {
    text: lines.join('\n'),
  };
}

function isEligible(entry: TopicEntry, now: Date): boolean {
  // Skip archived
  if (entry.status === 'archived') return false;

  // Skip snoozed
  if (entry.snoozeUntil && new Date(entry.snoozeUntil).getTime() > now.getTime()) return false;

  // Skip inactive (no activity for INACTIVE_AFTER_DAYS)
  if (entry.lastMessageAt) {
    const lastActive = new Date(entry.lastMessageAt).getTime();
    const inactiveMs = INACTIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    if (now.getTime() - lastActive > inactiveMs) return false;
  }

  // Skip if reported in last 24 hours
  if (entry.lastDoctorReportAt) {
    const lastReport = new Date(entry.lastDoctorReportAt).getTime();
    if (now.getTime() - lastReport < DOCTOR_PER_TOPIC_CAP_MS) return false;
  }

  return true;
}
