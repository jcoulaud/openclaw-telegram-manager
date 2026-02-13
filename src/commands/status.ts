import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import { topicKey } from '../lib/types.js';
import { jailCheck, rejectSymlink } from '../lib/security.js';
import { truncateMessage, relativeTime } from '../lib/telegram.js';
import { readFileOrNull, extractBlockers } from './daily-report.js';
import type { CommandContext, CommandResult } from './help.js';

// ── STATUS.md section parsers ──────────────────────────────────────────

const LAST_DONE_RE = /^##\s*Last done\s*\(UTC\)\s*\n([\s\S]*?)(?=\n##\s|\n*$)/im;
const NEXT_ACTIONS_RE = /^##\s*Next (?:3 )?actions(?: \(now\))?\s*\n([\s\S]*?)(?=\n##\s|\n*$)/im;
const UPCOMING_RE = /^##\s*Upcoming actions\s*\n([\s\S]*?)(?=\n##\s|\n*$)/im;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/;

function extractTimestamp(content: string): string | null {
  const match = content.match(LAST_DONE_RE);
  if (!match) return null;
  const iso = match[1]?.match(ISO_RE);
  return iso ? iso[0] : null;
}

function extractSection(content: string, re: RegExp): string {
  const match = content.match(re);
  if (!match) return '';
  return match[1]?.trim() ?? '';
}

function isPlaceholder(text: string): boolean {
  if (!text) return true;
  const stripped = text.replace(/[_*]/g, '').trim().toLowerCase();
  return stripped === 'none yet.' || stripped === 'none yet' || stripped === '' || stripped.startsWith('e.g.');
}

function formatSection(raw: string): string {
  if (isPlaceholder(raw)) return '_None yet._';
  return raw;
}

function hasBlockers(blockers: string): boolean {
  return blockers !== 'None.' && blockers !== 'No tasks recorded yet.';
}

// ── Format a human-friendly status summary ─────────────────────────────

export interface StatusData {
  name: string;
  type: string;
  statusContent: string;
  todoContent: string | null;
  expanded: boolean;
}

export function formatStatus(data: StatusData): string {
  const { name, type, statusContent, todoContent, expanded } = data;
  const timestamp = extractTimestamp(statusContent);
  const nextRaw = extractSection(statusContent, NEXT_ACTIONS_RE);
  const blockers = extractBlockers(todoContent);

  // Last done body text (everything after the timestamp)
  const doneMatch = statusContent.match(LAST_DONE_RE);
  let lastDoneBody = '';
  if (doneMatch) {
    const section = doneMatch[1]?.trim() ?? '';
    lastDoneBody = section.replace(ISO_RE, '').trim();
  }

  const lines: string[] = [];

  // Block 1: Goal (name + type)
  lines.push(`**${name}** \u00b7 ${type}`);

  // Block 2: Current status (last activity)
  if (timestamp) {
    lines.push(`\u{1f552} **Last activity:** ${relativeTime(timestamp)}`);
  }

  lines.push('');

  // Block 3: Done recently (only if non-empty)
  if (lastDoneBody && !isPlaceholder(lastDoneBody)) {
    lines.push('\u2705 **Done recently**');
    lines.push(lastDoneBody);
    lines.push('');
  }

  // Block 4: Next actions
  lines.push('\ud83c\udfaf **Next actions**');
  lines.push(formatSection(nextRaw));

  // Block 5: Blockers (only if present)
  if (hasBlockers(blockers)) {
    lines.push('');
    lines.push('\u26a0\ufe0f **Blockers**');
    lines.push(blockers);
  }

  // Expanded: also show upcoming
  if (expanded) {
    const upcomingRaw = extractSection(statusContent, UPCOMING_RE);
    if (!isPlaceholder(upcomingRaw)) {
      lines.push('');
      lines.push('\ud83d\udcc5 **Upcoming**');
      lines.push(upcomingRaw);
    }
  }

  return lines.join('\n');
}

// ── Command handler ────────────────────────────────────────────────────

export async function handleStatus(ctx: CommandContext, args: string): Promise<CommandResult> {
  const { workspaceDir, userId, groupId, threadId } = ctx;

  if (!userId || !groupId || !threadId) {
    return { text: 'Something went wrong — this command must be run inside a Telegram forum topic.' };
  }

  const registry = readRegistry(workspaceDir);

  // Auth check (user tier)
  const auth = checkAuthorization(userId, 'status', registry);
  if (!auth.authorized) {
    return { text: auth.message ?? 'Not authorized.' };
  }

  const key = topicKey(groupId, threadId);
  const entry = registry.topics[key];

  if (!entry) {
    return { text: 'This topic is not registered. Run /tm init first.' };
  }

  const projectsBase = path.join(workspaceDir, 'projects');
  const capsuleDir = path.join(projectsBase, entry.slug);

  // Path safety
  if (!jailCheck(projectsBase, entry.slug)) {
    return { text: 'Something went wrong — path validation failed.' };
  }

  if (rejectSymlink(capsuleDir)) {
    return { text: 'Something went wrong — detected an unsafe file system configuration.' };
  }

  const statusPath = path.join(capsuleDir, 'STATUS.md');

  if (!fs.existsSync(statusPath)) {
    return { text: 'No status available yet. Run /tm doctor to diagnose.' };
  }

  const expanded = args.trim() === '--expanded';

  try {
    const statusContent = fs.readFileSync(statusPath, 'utf-8');
    const todoContent = readFileOrNull(path.join(capsuleDir, 'TODO.md'));
    return {
      text: truncateMessage(formatStatus({
        name: entry.name,
        type: entry.type,
        statusContent,
        todoContent,
        expanded,
      })),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Failed to read topic status: ${msg}` };
  }
}
