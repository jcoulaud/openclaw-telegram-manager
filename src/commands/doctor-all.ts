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
import { buildDoctorReport, buildDoctorButtons, createRateLimitedPoster, truncateMessage } from '../lib/telegram.js';
import { runAllChecksForTopic, backupCapsuleIfHealthy } from '../lib/doctor-checks.js';
import { includePath } from '../lib/include-generator.js';
import {
  readFileOrNull,
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

// ── Per-topic outcome tracking ───────────────────────────────────────

export type SkipReason = 'archived' | 'snoozed' | 'inactive' | 'recently-checked';

export interface EligibilityResult {
  eligible: boolean;
  skipReason?: SkipReason;
}

interface TopicOutcome {
  name: string;
  slug: string;
  status: 'checked' | 'check-failed' | 'post-failed';
}

interface SkippedTopic {
  name: string;
  reason: SkipReason;
}

/**
 * Like `isEligible`, but returns the specific skip reason.
 * `isEligible` is kept for the registry-update loop (line 276).
 */
export function getEligibility(
  entry: TopicEntry,
  now: Date,
  statusTimestamp?: string | null,
): EligibilityResult {
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

  if (entry.lastDoctorReportAt) {
    const lastReport = new Date(entry.lastDoctorReportAt).getTime();
    if (now.getTime() - lastReport < DOCTOR_PER_TOPIC_CAP_MS) {
      return { eligible: false, skipReason: 'recently-checked' };
    }
  }

  return { eligible: true };
}

// ── Summary builder ──────────────────────────────────────────────────

const SKIP_ICONS: Record<SkipReason, string> = {
  archived: '\ud83d\udce6',   // 📦
  snoozed: '\ud83d\udca4',    // 💤
  inactive: '\ud83d\udd07',   // 🔇
  'recently-checked': '\u23f0', // ⏰
};

const SKIP_LABELS: Record<SkipReason, string> = {
  archived: 'archived',
  snoozed: 'snoozed',
  inactive: 'inactive',
  'recently-checked': 'recently checked',
};

export interface DoctorAllSummaryData {
  checkedTopics: TopicOutcome[];
  skippedTopics: SkippedTopic[];
  postFailures: number;
  migrationGroups: number;
  errors: string[];
}

const SUMMARY_SOFT_LIMIT = 3800;

export function buildDoctorAllSummary(data: DoctorAllSummaryData): string {
  const {
    checkedTopics,
    skippedTopics,
    postFailures,
    migrationGroups,
    errors,
  } = data;

  if (checkedTopics.length === 0 && skippedTopics.length === 0) {
    return '**Health Check Summary**\n\nNo topics registered yet.';
  }

  const lines: string[] = ['**Health Check Summary**', ''];

  // ── Checked topics ──
  let checkedRendered = 0;
  for (const t of checkedTopics) {
    let icon: string;
    let label: string;
    switch (t.status) {
      case 'checked':
        icon = '\u2705'; // ✅
        label = 'checked';
        break;
      case 'check-failed':
        icon = '\u274c'; // ❌
        label = 'check failed';
        break;
      case 'post-failed':
        icon = '\u26a0\ufe0f'; // ⚠️
        label = 'failed to post';
        break;
    }
    const line = `${icon} ${t.name} \u2014 ${label}`;
    if (lines.join('\n').length + line.length > SUMMARY_SOFT_LIMIT) {
      const remaining = checkedTopics.length - checkedRendered;
      lines.push(`... and ${remaining} more`);
      break;
    }
    lines.push(line);
    checkedRendered++;
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

  // ── Check errors (internal) ──
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

export async function handleDoctorAll(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir, configDir, logger } = ctx;

  const registry = readRegistry(workspaceDir);

  // When the autopilot calls doctor --all there is no Telegram user context,
  // so userId is undefined. Fall back to the first registered admin — the
  // autopilot acts on behalf of whoever set it up.
  const userId = ctx.userId ?? registry.topicManagerAdmins[0];
  if (!userId) {
    return { text: 'Something went wrong — could not identify your user account.' };
  }

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
  const checkedTopics: TopicOutcome[] = [];
  const skippedTopics: SkippedTopic[] = [];

  // Group tracking for migration detection
  const groupPostResults = new Map<string, { total: number; failed: number }>();

  for (const [_key, entry] of allEntries) {
    // Eligibility gating — consider STATUS.md timestamp alongside lastMessageAt
    const capsuleDir = path.join(projectsBase, entry.slug);
    const statusForEligibility = readFileOrNull(path.join(capsuleDir, 'STATUS.md'));
    const statusTs = statusForEligibility ? extractStatusTimestamp(statusForEligibility) : null;
    const eligibility = getEligibility(entry, now, statusTs);
    if (!eligibility.eligible) {
      skippedTopics.push({ name: entry.name, reason: eligibility.skipReason! });
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

      checkedTopics.push({ name: entry.name, slug: entry.slug, status: 'checked' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${entry.slug}: ${msg}`);
      logger.error(`[doctor-all] Error processing ${entry.slug}: ${msg}`);

      checkedTopics.push({ name: entry.name, slug: entry.slug, status: 'check-failed' });

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
  let postFailures = 0;
  const postFailedSlugs = new Set<string>();

  if (ctx.postFn && reports.length > 0) {
    const rateLimitedPost = createRateLimitedPoster(ctx.postFn);

    for (const report of reports) {
      try {
        await rateLimitedPost(report.groupId, report.threadId, report.text, report.keyboard);

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
        postFailures++;
        postFailedSlugs.add(report.slug);
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

    // Update outcomes for post-failed topics
    for (const outcome of checkedTopics) {
      if (postFailedSlugs.has(outcome.slug) && outcome.status === 'checked') {
        outcome.status = 'post-failed';
      }
    }
  }

  // Update registry: lastDoctorAllRunAt and per-topic timestamps
  await withRegistry(workspaceDir, (data) => {
    data.lastDoctorAllRunAt = now.toISOString();

    for (const [_key, entry] of Object.entries(data.topics)) {
      const dir = path.join(projectsBase, entry.slug);
      const statusFile = readFileOrNull(path.join(dir, 'STATUS.md'));
      const ts = statusFile ? extractStatusTimestamp(statusFile) : null;
      if (!isEligible(entry, now, ts)) continue;

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
  return {
    text: buildDoctorAllSummary({
      checkedTopics,
      skippedTopics,
      postFailures,
      migrationGroups: migrationGroups.length,
      errors,
    }),
  };
}

const STATUS_TIMESTAMP_RE = /^##\s*Last done\s*\(UTC\)/im;
const ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function extractStatusTimestamp(content: string): string | null {
  if (!STATUS_TIMESTAMP_RE.test(content)) return null;
  const idx = content.search(STATUS_TIMESTAMP_RE);
  const sectionAfter = content.slice(idx);
  const nextSection = sectionAfter.indexOf('\n## ', 1);
  const section = nextSection > 0 ? sectionAfter.slice(0, nextSection) : sectionAfter;
  const match = section.match(ISO_TIMESTAMP_RE);
  return match ? match[0] : null;
}

function mostRecent(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a && !b) return null;
  if (!a) return b!;
  if (!b) return a;
  return a > b ? a : b;
}

export function isEligible(entry: TopicEntry, now: Date, statusTimestamp?: string | null): boolean {
  // Skip archived
  if (entry.status === 'archived') return false;

  // Skip snoozed
  if (entry.snoozeUntil && new Date(entry.snoozeUntil).getTime() > now.getTime()) return false;

  // Skip inactive (no activity for INACTIVE_AFTER_DAYS)
  const lastActive = mostRecent(entry.lastMessageAt, statusTimestamp);
  if (lastActive) {
    const lastActiveMs = new Date(lastActive).getTime();
    const inactiveMs = INACTIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    if (now.getTime() - lastActiveMs > inactiveMs) return false;
  }

  // Skip if reported in last 24 hours
  if (entry.lastDoctorReportAt) {
    const lastReport = new Date(entry.lastDoctorReportAt).getTime();
    if (now.getTime() - lastReport < DOCTOR_PER_TOPIC_CAP_MS) return false;
  }

  return true;
}
