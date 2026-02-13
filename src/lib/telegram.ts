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

const HEALTH_LABELS: Record<string, string> = {
  fresh: '\u2705 Active',       // green check
  stale: '\u23f3 Inactive',     // hourglass
  blocked: '\u26a0\ufe0f Blocked', // warning
};

/**
 * Format a daily report for Telegram posting.
 * @param format - 'html' for direct postFn posts, 'markdown' for command responses
 */
export function buildDailyReport(data: DailyReportData, format: TextFormat = 'html'): string {
  const isHtml = format === 'html';
  const esc = (s: string) => isHtml ? htmlEscape(s) : s;
  const bold = (s: string) => isHtml ? `<b>${s}</b>` : `**${s}**`;
  const n = esc(data.name);
  const healthLabel = HEALTH_LABELS[data.health] ?? data.health;
  const lines = [
    bold(`Daily Report: ${n}`),
    '',
    bold('Done today'),
    esc(data.doneContent),
    '',
    bold('New learnings'),
    esc(data.learningsContent),
    '',
    bold('Blockers/Risks'),
    esc(data.blockersContent),
    '',
    bold('Next actions (now)'),
    esc(data.nextContent),
    '',
    bold('Upcoming'),
    esc(data.upcomingContent),
    '',
    `${bold('Health:')} ${healthLabel}`,
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
      { text: 'Snooze 7d', callback_data: cb('snooze7d') },
      { text: 'Snooze 30d', callback_data: cb('snooze30d') },
      { text: 'Archive topic', callback_data: cb('archive') },
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
  return buildInlineKeyboard([[{ text: 'Use this name', callback_data: cb }]]);
}

/**
 * Build Markdown Topic Card displayed after init.
 */
export function buildTopicCard(name: string, type: TopicType): string {
  return [
    `**${name}** is ready!`,
    '',
    `Type: ${type}`,
    '',
    '**How it works**',
    'Just talk to the AI in this topic like you normally would. Progress, TODOs, and decisions are tracked automatically so nothing is lost between sessions.',
    '',
    'Type /tm help if you ever need it.',
  ].join('\n');
}

// ── Init flow HTML builders (for direct postFn posting) ─────────────

/**
 * Build HTML for init step 1: welcome + type picker.
 * Posted directly via postFn to bypass AI reformatting.
 */
export function buildInitWelcomeHtml(): string {
  return [
    '<b>Set up this topic</b>',
    '',
    'The AI will remember everything across sessions \u2014 progress, decisions, TODOs, and notes are saved automatically.',
    '',
    '<b>Pick a type:</b>',
    '\u2022 <b>Coding</b> \u2014 tracks architecture decisions and deployment steps',
    '\u2022 <b>Research</b> \u2014 tracks sources and key findings',
    '\u2022 <b>Marketing</b> \u2014 tracks campaigns and metrics',
    '\u2022 <b>Custom</b> \u2014 general-purpose tracking',
    '',
    '<i>The AI may take a few seconds to respond \u2014 no need to tap twice.</i>',
  ].join('\n');
}

/**
 * Build HTML for init step 2: name confirmation.
 * Posted directly via postFn to bypass AI reformatting.
 */
export function buildInitNameConfirmHtml(name: string, type: TopicType): string {
  const n = htmlEscape(name);
  const t = htmlEscape(type);
  return [
    '<b>Almost there!</b>',
    '',
    `Name: <b>${n}</b>`,
    `Type: ${t}`,
    '',
    'You\'ll see this name in reports and health checks.',
    '',
    `For a custom name: <code>/tm init your-name ${t}</code>`,
  ].join('\n');
}

/**
 * Build HTML for init step 3: topic card after successful init.
 * Posted directly via postFn to bypass AI reformatting.
 */
export function buildTopicCardHtml(name: string, type: TopicType): string {
  const n = htmlEscape(name);
  const t = htmlEscape(type);
  return [
    `<b>\u2705 ${n}</b> is ready!`,
    '',
    `Type: ${t}`,
    '',
    '<b>How it works</b>',
    'Just talk to the AI in this topic like you normally would. Progress, TODOs, and decisions are tracked automatically so nothing is lost between sessions.',
    '',
    'Type /tm help if you ever need it.',
  ].join('\n');
}

/**
 * Wrap /tm commands in code formatting (backticks for markdown, <code> for HTML).
 */
function formatCommands(text: string, isHtml: boolean): string {
  return text.replace(/\/tm\s\S+(?:\s\S+)*/g, (match) =>
    isHtml ? `<code>${htmlEscape(match)}</code>` : `\`${match}\``,
  );
}

/**
 * Build doctor report with severity icons.
 * @param format - 'markdown' for command responses, 'html' for direct postFn posts
 */
export function buildDoctorReport(name: string, results: DoctorCheckResult[], format: TextFormat = 'markdown'): string {
  const isHtml = format === 'html';
  const n = isHtml ? htmlEscape(name) : name;
  const bold = (s: string) => isHtml ? `<b>${s}</b>` : `**${s}**`;
  const lines: string[] = [bold(`Health check: ${n}`), ''];

  // Filter out INFO-level results — only show warnings and errors
  const significant = results.filter(r => r.severity !== Severity.INFO);

  if (significant.length === 0) {
    lines.push('All good \u2014 no issues found.');
    return lines.join('\n');
  }

  for (let i = 0; i < significant.length; i++) {
    const r = significant[i]!;
    const icon = severityIcon(r.severity);
    const msg = isHtml ? htmlEscape(r.message) : r.message;
    lines.push(`${icon} ${msg}`);
    if (r.remediation) {
      const rem = formatCommands(r.remediation, isHtml);
      lines.push(`  \u2192 ${rem}`);
    }
    // Blank line between items
    if (i < significant.length - 1) {
      lines.push('');
    }
  }

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
    '**Basics**',
    '/tm init — set up this topic',
    '/tm status — see current progress',
    '/tm list — all topics',
    '/tm help — this message',
    '',
    '**Health & reports**',
    '/tm doctor — run health checks',
    '/tm doctor --all — check all topics at once',
    '/tm daily-report — post a daily summary',
    '/tm autopilot enable — automatic daily health checks',
    '/tm autopilot disable — turn off automatic checks',
    '',
    '**Manage topics**',
    '/tm rename new-name — rename this topic',
    '/tm snooze 7d — pause health checks (e.g. 7d, 30d)',
    '/tm archive — archive this topic',
    '/tm unarchive — bring back an archived topic',
    '/tm sync — fix config if out of sync',
    '/tm upgrade — update topic files to latest version',
  ].join('\n');
}

/**
 * Build compact topic list message in Markdown.
 * Groups by status: active first, snoozed, then archived.
 */
export function buildListMessage(topics: TopicEntry[]): string {
  if (topics.length === 0) {
    return '**Your topics**\n\nNo topics yet. Type /tm init in any topic to get started.';
  }

  const sorted = [...topics].sort((a, b) => {
    const order = { active: 0, snoozed: 1, archived: 2 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3);
  });

  const count = topics.length;
  const lines: string[] = [`**Your topics** (${count})`, ''];
  let rendered = 0;

  for (const t of sorted) {
    const activity = t.lastMessageAt ? relativeTime(t.lastMessageAt) : 'no activity yet';
    const statusTag = t.status !== 'active' ? ` \u2014 ${t.status}` : '';
    const entry = `**${t.name}** \u00b7 ${t.type}${statusTag}\n  ${activity}`;

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
export function relativeTime(iso: string): string {
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
