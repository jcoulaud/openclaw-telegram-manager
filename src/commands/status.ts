import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import { topicKey } from '../lib/types.js';
import { jailCheck, rejectSymlink } from '../lib/security.js';
import { truncateMessage, relativeTime } from '../lib/telegram.js';
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

// ── Format a human-friendly status summary ─────────────────────────────

function formatStatus(name: string, content: string): string {
  const timestamp = extractTimestamp(content);
  const nextRaw = extractSection(content, NEXT_ACTIONS_RE);
  const upcomingRaw = extractSection(content, UPCOMING_RE);

  // Last done body text (everything after the timestamp)
  const doneMatch = content.match(LAST_DONE_RE);
  let lastDoneBody = '';
  if (doneMatch) {
    const section = doneMatch[1]?.trim() ?? '';
    // Remove the timestamp line, keep the rest
    lastDoneBody = section.replace(ISO_RE, '').trim();
  }

  const lines: string[] = [
    `**${name}**`,
    '',
  ];

  // Last activity
  if (timestamp) {
    lines.push(`\u{1f552} **Last activity:** ${relativeTime(timestamp)}`); // 🕒
  }

  // Last done summary (if there's text beyond the timestamp)
  if (lastDoneBody && !isPlaceholder(lastDoneBody)) {
    lines.push(lastDoneBody);
  }

  lines.push('');

  // Next actions
  lines.push('\ud83c\udfaf **Next actions**'); // 🎯
  lines.push(formatSection(nextRaw));

  // Upcoming (only show if non-empty)
  const upcomingFormatted = formatSection(upcomingRaw);
  if (upcomingFormatted !== '_None yet._') {
    lines.push('');
    lines.push('\ud83d\udcc5 **Upcoming**'); // 📅
    lines.push(upcomingFormatted);
  }

  return lines.join('\n');
}

// ── Command handler ────────────────────────────────────────────────────

export async function handleStatus(ctx: CommandContext): Promise<CommandResult> {
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

  try {
    const content = fs.readFileSync(statusPath, 'utf-8');
    return {
      text: truncateMessage(formatStatus(entry.name, content)),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Failed to read topic status: ${msg}` };
  }
}
