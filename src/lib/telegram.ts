import { htmlEscape, buildCallbackData } from './security.js';
import type { TopicEntry, DoctorCheckResult, InlineKeyboardButton, InlineKeyboardMarkup } from './types.js';
import { Severity } from './types.js';
import type { TopicType } from './types.js';

// ── Telegram message limit ─────────────────────────────────────────────

const TELEGRAM_MSG_LIMIT = 4096;

// Re-export keyboard types from canonical location
export type { InlineKeyboardButton, InlineKeyboardMarkup } from './types.js';

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
  slug: string,
  groupId: string,
  threadId: string,
  secret: string,
): InlineKeyboardMarkup {
  const cb = (action: string) => buildCallbackData(action, slug, groupId, threadId, secret);
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
 * Build inline keyboard with a [Confirm] button for slug confirmation (init step 1).
 */
export function buildInitSlugButtons(
  slug: string,
  groupId: string,
  threadId: string,
  secret: string,
): InlineKeyboardMarkup {
  const cb = (action: string) => buildCallbackData(action, slug, groupId, threadId, secret);
  return buildInlineKeyboard([
    [{ text: 'Confirm', callback_data: cb('is') }],
  ]);
}

/**
 * Build inline keyboard with type picker buttons for init step 2.
 */
export function buildInitTypeButtons(
  slug: string,
  groupId: string,
  threadId: string,
  secret: string,
): InlineKeyboardMarkup {
  const cb = (action: string) => buildCallbackData(action, slug, groupId, threadId, secret);
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
 * Build HTML Topic Card displayed after init.
 */
export function buildTopicCard(slug: string, type: TopicType, capsuleVersion: number): string {
  const s = htmlEscape(slug);
  const t = htmlEscape(type);
  const v = htmlEscape(String(capsuleVersion));
  return [
    `<b>Topic: ${s}</b>`,
    `Type: ${t} | Version: ${v}`,
    `Capsule: projects/${s}/`,
    '',
    '<b>Commands:</b>',
    '/topic doctor \u2014 health checks',
    '/topic status \u2014 quick view',
    '/topic sync \u2014 re-apply config',
    '/topic list \u2014 all topics',
    '/topic archive \u2014 archive this topic',
    '/topic help \u2014 command reference',
  ].join('\n');
}

/**
 * Build HTML doctor report with severity icons.
 */
export function buildDoctorReport(slug: string, results: DoctorCheckResult[]): string {
  const s = htmlEscape(slug);
  const lines: string[] = [`<b>Doctor: ${s}</b>`, ''];

  if (results.length === 0) {
    lines.push('All checks passed.');
    return lines.join('\n');
  }

  for (const r of results) {
    const icon = severityIcon(r.severity);
    const msg = htmlEscape(r.message);
    const fix = r.fixable ? ' [fixable]' : '';
    lines.push(`${icon} <code>${htmlEscape(r.checkId)}</code>: ${msg}${fix}`);
  }

  lines.push('');
  lines.push('Reply /topic doctor to re-check, or use the buttons below.');

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
 * Build HTML help card with command reference.
 */
export function buildHelpCard(): string {
  return [
    '<b>Topic Manager Commands</b>',
    '',
    '/topic init \u2014 register this topic',
    '/topic doctor \u2014 run health checks',
    '/topic doctor --all \u2014 check all topics',
    '/topic status \u2014 quick STATUS.md view',
    '/topic list \u2014 show all topics',
    '/topic sync \u2014 re-apply config',
    '/topic rename &lt;slug&gt; \u2014 rename topic',
    '/topic upgrade \u2014 update capsule template',
    '/topic snooze &lt;Nd&gt; \u2014 snooze doctor (7d, 30d, etc.)',
    '/topic archive \u2014 archive topic',
    '/topic unarchive \u2014 reactivate topic',
    '/topic help \u2014 this message',
  ].join('\n');
}

/**
 * Build compact topic list message in HTML.
 * Groups by status: active first, snoozed, then archived.
 */
export function buildListMessage(topics: TopicEntry[]): string {
  if (topics.length === 0) {
    return '<b>Topic Registry</b> (0 topics)\n\nNo topics registered.';
  }

  const sorted = [...topics].sort((a, b) => {
    const order = { active: 0, snoozed: 1, archived: 2 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3);
  });

  const lines: string[] = [`<b>Topic Registry</b> (${topics.length} topics)`, ''];
  let rendered = 0;

  for (const t of sorted) {
    const entry = [
      `<code>${htmlEscape(t.slug)}</code> [${htmlEscape(t.type)}] ${htmlEscape(t.status)}`,
      `  Last active: ${t.lastMessageAt ? relativeTime(t.lastMessageAt) : 'never'}`,
      `  Thread: #${htmlEscape(t.threadId)}`,
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
  let truncated = msg.slice(0, limit - suffix.length);
  // Strip any incomplete HTML tag at the truncation point
  const lastOpen = truncated.lastIndexOf('<');
  if (lastOpen !== -1 && lastOpen > truncated.lastIndexOf('>')) {
    truncated = truncated.slice(0, lastOpen);
  }
  return truncated + suffix;
}
