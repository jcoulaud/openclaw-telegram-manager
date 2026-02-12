import { htmlEscape, buildCallbackData } from './security.js';
import type { TopicEntry, DoctorCheckResult, InlineKeyboardButton, InlineKeyboardMarkup } from './types.js';
import { Severity } from './types.js';
import type { TopicType } from './types.js';

export type TextFormat = 'html' | 'markdown';

// ── Telegram message limit ─────────────────────────────────────────────

const TELEGRAM_MSG_LIMIT = 4096;

// Re-export keyboard types from canonical location
export type { InlineKeyboardButton, InlineKeyboardMarkup } from './types.js';

// ── Daily report ────────────────────────────────────────────────────────

export interface DailyReportData {
  name: string;
  doneContent: string;
  learningsContent: string;
  blockersContent: string;
  nextContent: string;
  upcomingContent: string;
  health: 'fresh' | 'stale' | 'blocked';
}

/**
 * Format a daily report as HTML for Telegram posting.
 */
export function buildDailyReport(data: DailyReportData): string {
  const n = htmlEscape(data.name);
  const lines = [
    `<b>Daily Report: ${n}</b>`,
    '',
    `<b>Done today</b>`,
    htmlEscape(data.doneContent),
    '',
    `<b>New learnings</b>`,
    htmlEscape(data.learningsContent),
    '',
    `<b>Blockers/Risks</b>`,
    htmlEscape(data.blockersContent),
    '',
    `<b>Next actions (now)</b>`,
    htmlEscape(data.nextContent),
    '',
    `<b>Upcoming</b>`,
    htmlEscape(data.upcomingContent),
    '',
    `<b>Health:</b> ${data.health}`,
  ];
  return truncateMessage(lines.join('\n'));
}

// ── Rate limiting config ───────────────────────────────────────────────

export interface RateLimitConfig {
  sameGroupDelayMs: number;
  crossGroupDelayMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  sameGroupDelayMs: 4000,
  crossGroupDelayMs: 1000,
};

// ── Builders ───────────────────────────────────────────────────────────

/**
 * Build an InlineKeyboardMarkup from rows of buttons.
 */
export function buildInlineKeyboard(rows: InlineKeyboardButton[][]): InlineKeyboardMarkup {
  return { inline_keyboard: rows };
}

/**
 * Build inline keyboard buttons for a doctor report.
 */
export function buildDoctorButtons(
  groupId: string,
  threadId: string,
  secret: string,
  userId: string,
): InlineKeyboardMarkup {
  const cb = (action: string) => buildCallbackData(action, groupId, threadId, secret, userId);
  return buildInlineKeyboard([
    [
      { text: 'Fix', callback_data: cb('fix') },
      { text: 'Snooze 7d', callback_data: cb('snooze7d') },
      { text: 'Snooze 30d', callback_data: cb('snooze30d') },
    ],
    [
      { text: 'Archive', callback_data: cb('archive') },
      { text: 'Ignore check', callback_data: cb('ignore') },
    ],
  ]);
}

/**
 * Build inline keyboard with type picker buttons for init.
 */
export function buildInitTypeButtons(
  groupId: string,
  threadId: string,
  secret: string,
  userId: string,
): InlineKeyboardMarkup {
  const cb = (action: string) => buildCallbackData(action, groupId, threadId, secret, userId);
  return buildInlineKeyboard([
    [
      { text: 'Coding', callback_data: cb('ic') },
      { text: 'Research', callback_data: cb('ir') },
    ],
    [
      { text: 'Marketing', callback_data: cb('im') },
      { text: 'Custom', callback_data: cb('ix') },
    ],
  ]);
}

/**
 * Build inline keyboard with a single [Confirm] button for init name confirmation.
 * Action codes: yc=coding, yr=research, ym=marketing, yx=custom.
 */
export function buildInitConfirmButton(
  groupId: string,
  threadId: string,
  secret: string,
  userId: string,
  type: TopicType,
): InlineKeyboardMarkup {
  const actionMap: Record<TopicType, string> = {
    coding: 'yc',
    research: 'yr',
    marketing: 'ym',
    custom: 'yx',
  };
  const cb = buildCallbackData(actionMap[type], groupId, threadId, secret, userId);
  return buildInlineKeyboard([[{ text: 'Confirm', callback_data: cb }]]);
}

/**
 * Build Markdown Topic Card displayed after init.
 */
export function buildTopicCard(name: string, slug: string, type: TopicType, capsuleVersion: number): string {
  return [
    `**Topic: ${name}**`,
    `Type: ${type} | Version: ${capsuleVersion}`,
    `Capsule: projects/${slug}/`,
    '',
    '**How it works**',
    'Just send your instructions in this topic. The agent',
    'maintains STATUS.md and TODO.md automatically as it',
    'works — nothing is lost on reset or context compaction.',
    'Doctor checks run periodically and alert you if anything',
    'needs attention.',
    '',
    '**Commands:**',
    '/tm status — quick STATUS.md view',
    '/tm doctor — run health checks',
    '/tm rename <name> — rename this topic',
    '/tm list — all topics',
    '/tm archive — archive this topic',
    '/tm help — full command reference',
  ].join('\n');
}

/**
 * Build doctor report with severity icons.
 * @param format - 'markdown' for command responses, 'html' for direct postFn posts
 */
export function buildDoctorReport(name: string, results: DoctorCheckResult[], format: TextFormat = 'markdown'): string {
  const isHtml = format === 'html';
  const n = isHtml ? htmlEscape(name) : name;
  const bold = (s: string) => isHtml ? `<b>${s}</b>` : `**${s}**`;
  const code = (s: string) => isHtml ? `<code>${s}</code>` : `\`${s}\``;
  const lines: string[] = [bold(`Doctor: ${n}`), ''];

  if (results.length === 0) {
    lines.push('All checks passed.');
    return lines.join('\n');
  }

  for (const r of results) {
    const icon = severityIcon(r.severity);
    const msg = isHtml ? htmlEscape(r.message) : r.message;
    const checkId = isHtml ? htmlEscape(r.checkId) : r.checkId;
    const fix = r.fixable ? ' [fixable]' : '';
    lines.push(`${icon} ${code(checkId)}: ${msg}${fix}`);
  }

  lines.push('');
  lines.push('Reply /tm doctor to re-check, or use the buttons below.');

  return truncateMessage(lines.join('\n'));
}

function severityIcon(severity: Severity): string {
  switch (severity) {
    case Severity.ERROR:
      return '\u274c';  // red X
    case Severity.WARN:
      return '\u26a0\ufe0f'; // warning
    case Severity.INFO:
      return '\u2139\ufe0f'; // info
    default:
      return '\u2022';
  }
}

/**
 * Build Markdown help card with command reference.
 */
export function buildHelpCard(): string {
  return [
    '**Topic Manager Commands**',
    '',
    '/tm init — register this topic',
    '/tm status — quick STATUS.md view',
    '/tm doctor — run health checks',
    '/tm doctor --all — check all topics',
    '/tm rename <name> — rename this topic',
    '/tm list — all topics',
    '/tm sync — re-apply config',
    '/tm upgrade — update capsule template',
    '/tm snooze <Nd> — snooze doctor (7d, 30d, etc.)',
    '/tm archive — archive topic',
    '/tm unarchive — reactivate topic',
    '/tm autopilot [enable|disable|status] — daily sweeps',
    '/tm daily-report — generate daily status report',
    '/tm help — this message',
  ].join('\n');
}

/**
 * Build compact topic list message in Markdown.
 * Groups by status: active first, snoozed, then archived.
 */
export function buildListMessage(topics: TopicEntry[]): string {
  if (topics.length === 0) {
    return '**Topic Registry** (0 topics)\n\nNo topics registered.';
  }

  const sorted = [...topics].sort((a, b) => {
    const order = { active: 0, snoozed: 1, archived: 2 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3);
  });

  const lines: string[] = [`**Topic Registry** (${topics.length} topics)`, ''];
  let rendered = 0;

  for (const t of sorted) {
    const entry = [
      `**${t.name}** [${t.type}] ${t.status}`,
      `  Last active: ${t.lastMessageAt ? relativeTime(t.lastMessageAt) : 'never'}`,
      `  Thread: #${t.threadId}`,
    ].join('\n');

    // Check if adding this entry would exceed limit
    const tentative = [...lines, entry, ''].join('\n');
    if (tentative.length > TELEGRAM_MSG_LIMIT - 40) {
      const remaining = sorted.length - rendered;
      lines.push(`... and ${remaining} more`);
      break;
    }

    lines.push(entry);
    lines.push('');
    rendered++;
  }

  return truncateMessage(lines.join('\n'));
}

/**
 * Convert an ISO timestamp to a relative time string.
 */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Rate-limited posting helper ────────────────────────────────────────

/**
 * Helper that wraps a post function with rate limiting delays.
 * Returns a function that posts messages respecting Telegram rate limits.
 *
 * The postFn should handle the actual Telegram API call.
 * If postFn throws with a 429 status, the helper respects retry_after.
 */
export function createRateLimitedPoster(
  postFn: (groupId: string, threadId: string, text: string, keyboard?: InlineKeyboardMarkup) => Promise<void>,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT,
): (groupId: string, threadId: string, text: string, keyboard?: InlineKeyboardMarkup) => Promise<void> {
  let lastPostTime = 0;
  let lastGroupId = '';

  return async (groupId, threadId, text, keyboard) => {
    const now = Date.now();
    const delay = groupId === lastGroupId
      ? config.sameGroupDelayMs
      : config.crossGroupDelayMs;
    const elapsed = now - lastPostTime;

    if (elapsed < delay) {
      await sleep(delay - elapsed);
    }

    try {
      await postFn(groupId, threadId, text, keyboard);
    } catch (err: unknown) {
      if (isTooManyRequestsError(err)) {
        const retryAfter = getRetryAfter(err);
        await sleep(retryAfter * 1000);
        await postFn(groupId, threadId, text, keyboard);
      } else {
        throw err;
      }
    }

    lastPostTime = Date.now();
    lastGroupId = groupId;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTooManyRequestsError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as Record<string, unknown>)['status'];
    return typeof status === 'number' && status === 429;
  }
  return false;
}

function getRetryAfter(err: unknown): number {
  if (err && typeof err === 'object' && 'retryAfter' in err) {
    const val = (err as { retryAfter: unknown }).retryAfter;
    if (typeof val === 'number' && val > 0) return val;
  }
  // Default to 5 seconds if retry_after is not available
  return 5;
}

// ── Message truncation ─────────────────────────────────────────────────

/**
 * Truncate a message to fit within Telegram's limit.
 * Appends a truncation indicator if the message was cut.
 */
export function truncateMessage(msg: string, limit: number = TELEGRAM_MSG_LIMIT): string {
  if (msg.length <= limit) return msg;
  const suffix = '\n\n... (truncated)';
  const truncated = msg.slice(0, limit - suffix.length);
  return truncated + suffix;
}
