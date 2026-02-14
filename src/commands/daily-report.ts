import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRegistry, withRegistry } from '../lib/registry.js';
import { topicKey, MAX_POST_ERROR_LENGTH } from '../lib/types.js';
import { buildDailyReport } from '../lib/telegram.js';
import type { CommandContext, CommandResult } from './help.js';

export async function handleDailyReport(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir, groupId, threadId, logger } = ctx;

  if (!groupId || !threadId) {
    return { text: 'Something went wrong — this command must be run inside a Telegram forum topic.' };
  }

  const key = topicKey(groupId, threadId);
  const registry = readRegistry(workspaceDir);
  const entry = registry.topics[key];

  if (!entry) {
    return { text: 'This topic is not registered. Run /tm init first.' };
  }

  // Dedup: skip if already reported today
  if (entry.lastDailyReportAt) {
    const lastReport = new Date(entry.lastDailyReportAt);
    const now = new Date();
    if (
      lastReport.getUTCFullYear() === now.getUTCFullYear() &&
      lastReport.getUTCMonth() === now.getUTCMonth() &&
      lastReport.getUTCDate() === now.getUTCDate()
    ) {
      return { text: 'Daily report already generated today. Try again tomorrow.' };
    }
  }

  const projectsBase = path.join(workspaceDir, 'projects');
  const capsuleDir = path.join(projectsBase, entry.slug);

  if (!fs.existsSync(capsuleDir)) {
    return { text: 'Topic files not found. Run /tm init to set up this topic.' };
  }

  // Read capsule files
  const statusContent = readFileOrNull(path.join(capsuleDir, 'STATUS.md'));

  // Extract sections
  const doneContent = extractDoneSection(statusContent);
  const blockers = extractBlockers(statusContent);
  const nextContent = extractNextActions(statusContent);

  const reportData = {
    name: entry.name,
    doneContent,
    blockersContent: blockers,
    nextContent,
  };

  // Post to topic if postFn available
  if (ctx.postFn) {
    try {
      const htmlReport = buildDailyReport(reportData, 'html');
      await ctx.postFn(groupId, threadId, htmlReport);
      await withRegistry(workspaceDir, (data) => {
        const e = data.topics[key];
        if (e) {
          e.lastDailyReportAt = new Date().toISOString();
          e.lastPostError = null;
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[daily-report] Post failed: ${msg}`);
      await withRegistry(workspaceDir, (data) => {
        const e = data.topics[key];
        if (e) {
          e.lastPostError = msg.slice(0, MAX_POST_ERROR_LENGTH);
        }
      });
      return { text: `Daily report generated but post failed: ${msg}` };
    }
  } else {
    // Update lastDailyReportAt even without posting
    await withRegistry(workspaceDir, (data) => {
      const e = data.topics[key];
      if (e) {
        e.lastDailyReportAt = new Date().toISOString();
      }
    });
  }

  return { text: buildDailyReport(reportData, 'markdown') };
}

// ── Helpers ────────────────────────────────────────────────────────────

export function readFileOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function extractDoneSection(statusContent: string | null): string {
  if (!statusContent) return 'No status available yet.';
  const match = statusContent.match(/^##\s*Last done\s*\(UTC\)\s*\n([\s\S]*?)(?=\n##\s|\n*$)/im);
  if (!match) return 'No recent activity found.';
  const text = match[1]?.trim();
  return text || 'Empty.';
}

export function extractBlockers(statusContent: string | null): string {
  if (!statusContent) return 'No tasks recorded yet.';
  // Extract Backlog section from STATUS.md
  const backlogMatch = statusContent.match(/^##\s*Backlog\b.*\n((?:(?!\n## )[\s\S])*)/im);
  const backlogSection = backlogMatch ? backlogMatch[1] ?? '' : statusContent;
  const lines = backlogSection.split('\n');
  const blockerLines = lines.filter(
    (l) => /\[BLOCKED\]/i.test(l) || /\bblocked\b/i.test(l),
  );
  return blockerLines.length > 0 ? blockerLines.join('\n') : 'None.';
}

export function extractNextActions(statusContent: string | null): string {
  if (!statusContent) return 'No status available yet.';
  const match = statusContent.match(/^##\s*Next (?:3 )?actions(?: \(now\))?\s*\n([\s\S]*?)(?=\n##\s|\n*$)/im);
  if (!match) return 'None yet.';
  const text = match[1]?.trim();
  return text || 'None yet.';
}

