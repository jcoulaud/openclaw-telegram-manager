import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRegistry, withRegistry } from '../lib/registry.js';
import { topicKey } from '../lib/types.js';
import { buildDailyReport } from '../lib/telegram.js';
import type { CommandContext, CommandResult } from './help.js';

export async function handleDailyReport(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir, groupId, threadId, logger } = ctx;

  if (!groupId || !threadId) {
    return { text: 'Missing context: must be called from a topic thread.' };
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

  // Post to topic if postFn available
  if (ctx.postFn) {
    try {
      const htmlReport = buildDailyReport(reportData, 'html');
      await ctx.postFn(groupId, threadId, htmlReport);
      await withRegistry(workspaceDir, (data) => {
        const e = data.topics[key];
        if (e) {
          e.lastDailyReportAt = new Date().toISOString();
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[daily-report] Post failed: ${msg}`);
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

function readFileOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function extractDoneSection(statusContent: string | null): string {
  if (!statusContent) return '_No STATUS.md found._';
  const match = statusContent.match(/^##\s*Last done\s*\(UTC\)\s*\n([\s\S]*?)(?=\n##\s|\n*$)/im);
  if (!match) return '_No "Last done" section found._';
  const text = match[1]?.trim();
  return text || '_Empty._';
}

function extractTodayLearnings(learningsContent: string | null): string {
  if (!learningsContent) return '_No LEARNINGS.md found._';
  const today = new Date().toISOString().slice(0, 10);
  const lines = learningsContent.split('\n');
  const todayLines: string[] = [];
  let inTodaySection = false;

  for (const line of lines) {
    if (line.startsWith('## ') && line.includes(today)) {
      inTodaySection = true;
      continue;
    }
    if (inTodaySection && line.startsWith('## ')) {
      break;
    }
    if (inTodaySection && line.trim()) {
      todayLines.push(line);
    }
  }

  return todayLines.length > 0 ? todayLines.join('\n') : '_None today._';
}

function extractBlockers(todoContent: string | null): string {
  if (!todoContent) return '_No TODO.md found._';
  const lines = todoContent.split('\n');
  const blockerLines = lines.filter(
    (l) => /\[BLOCKED\]/i.test(l) || /\bblocked\b/i.test(l),
  );
  return blockerLines.length > 0 ? blockerLines.join('\n') : '_None._';
}

function extractNextActions(statusContent: string | null): string {
  if (!statusContent) return '_No STATUS.md found._';
  const match = statusContent.match(/^##\s*Next (?:3 )?actions(?: \(now\))?\s*\n([\s\S]*?)(?=\n##\s|\n*$)/im);
  if (!match) return '_No "Next actions" section found._';
  const text = match[1]?.trim();
  return text || '_Empty._';
}

function extractUpcoming(statusContent: string | null): string {
  if (!statusContent) return '_No STATUS.md found._';
  const match = statusContent.match(/^##\s*Upcoming actions\s*\n([\s\S]*?)(?=\n##\s|\n*$)/im);
  if (!match) return '_No "Upcoming actions" section found._';
  const text = match[1]?.trim();
  return text || '_Empty._';
}

export function computeHealth(
  lastMessageAt: string | null,
  statusContent: string | null,
  blockers: string,
): 'fresh' | 'stale' | 'blocked' {
  if (blockers && blockers !== '_None._' && blockers !== '_No TODO.md found._') {
    return 'blocked';
  }

  if (!lastMessageAt) return 'stale';

  const hoursSinceActivity = (Date.now() - new Date(lastMessageAt).getTime()) / 3_600_000;
  if (hoursSinceActivity > 72) return 'stale';

  return 'fresh';
}
