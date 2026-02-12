import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRegistry, withRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import {
  DOCTOR_ALL_COOLDOWN_MS,
  DOCTOR_PER_TOPIC_CAP_MS,
  INACTIVE_AFTER_DAYS,
  SPAM_THRESHOLD,
} from '../lib/types.js';
import type { TopicEntry, InlineKeyboardMarkup } from '../lib/types.js';
import { htmlEscape } from '../lib/security.js';
import { buildDoctorReport, buildDoctorButtons } from '../lib/telegram.js';
import { runAllChecksForTopic } from '../lib/doctor-checks.js';
import { includePath } from '../lib/include-generator.js';
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
    return { text: 'Missing context: userId not available.' };
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
        text: `Doctor-all was run ${Math.floor(elapsed / 60_000)} minutes ago. Try again in ${remainingMin} minute(s).`,
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

      const reportText = buildDoctorReport(entry.name, results);
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

  // Update registry: lastDoctorAllRunAt and per-topic timestamps
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
  });

  // Build summary
  const lines: string[] = [
    `<b>Doctor All Summary</b>`,
    '',
    `Processed: ${processed}`,
    `Skipped (ineligible): ${skipped}`,
    `Total: ${allEntries.length}`,
  ];

  if (errors.length > 0) {
    lines.push('');
    lines.push(`<b>Errors (${errors.length}):</b>`);
    for (const e of errors.slice(0, 10)) {
      lines.push(`- ${htmlEscape(e)}`);
    }
    if (errors.length > 10) {
      lines.push(`... and ${errors.length - 10} more`);
    }
  }

  if (migrationGroups.length > 0) {
    lines.push('');
    lines.push('<b>Possible group migrations detected:</b>');
    for (const gid of migrationGroups) {
      lines.push(`- Group ${htmlEscape(gid)}: all topics failed. Check for group migration.`);
    }
  }

  // Per-topic reports are returned as a summary for the calling context.
  // The tool router is responsible for posting individual reports to each topic.
  // Here we return the summary to the current thread.
  return {
    text: lines.join('\n'),
    parseMode: 'HTML',
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
