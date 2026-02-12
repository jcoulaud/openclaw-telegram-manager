import { Type, type Static } from '@sinclair/typebox';

// ── Constants ──────────────────────────────────────────────────────────

export const CURRENT_REGISTRY_VERSION = 4;
export const CAPSULE_VERSION = 3;
export const MAX_EXTRAS_BYTES = 10_240;
export const MAX_POST_ERROR_LENGTH = 500;
export const MAX_TOPICS_DEFAULT = 100;
export const MAX_NAME_LENGTH = 100;
export const DOCTOR_ALL_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
export const DOCTOR_PER_TOPIC_CAP_MS = 24 * 60 * 60 * 1000; // 24 hours
export const INACTIVE_AFTER_DAYS = 7;
export const SPAM_THRESHOLD = 3;

// ── Enums ──────────────────────────────────────────────────────────────

export const TopicType = {
  Coding: 'coding',
  Research: 'research',
  Marketing: 'marketing',
  Custom: 'custom',
} as const;

export type TopicType = (typeof TopicType)[keyof typeof TopicType];

export const TopicStatus = {
  Active: 'active',
  Snoozed: 'snoozed',
  Archived: 'archived',
} as const;

export type TopicStatus = (typeof TopicStatus)[keyof typeof TopicStatus];

export const Severity = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
} as const;

export type Severity = (typeof Severity)[keyof typeof Severity];

// ── Typebox Schemas ────────────────────────────────────────────────────

export const TopicTypeSchema = Type.Union([
  Type.Literal('coding'),
  Type.Literal('research'),
  Type.Literal('marketing'),
  Type.Literal('custom'),
]);

export const TopicStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('snoozed'),
  Type.Literal('archived'),
]);

export const TopicEntrySchema = Type.Object({
  groupId: Type.String({ pattern: '^-?\\d+$' }),
  threadId: Type.String({ pattern: '^\\d+$' }),
  slug: Type.String({ pattern: '^[a-z][a-z0-9-]{0,49}$' }),
  name: Type.String({ minLength: 1, maxLength: MAX_NAME_LENGTH }),
  type: TopicTypeSchema,
  status: TopicStatusSchema,
  capsuleVersion: Type.Integer({ minimum: 1 }),
  lastMessageAt: Type.Union([Type.String(), Type.Null()]),
  lastDoctorReportAt: Type.Union([Type.String(), Type.Null()]),
  lastDoctorRunAt: Type.Union([Type.String(), Type.Null()]),
  lastCapsuleWriteAt: Type.Union([Type.String(), Type.Null()]),
  snoozeUntil: Type.Union([Type.String(), Type.Null()]),
  ignoreChecks: Type.Array(Type.String()),
  consecutiveSilentDoctors: Type.Integer({ minimum: 0 }),
  lastPostError: Type.Union([Type.String({ maxLength: MAX_POST_ERROR_LENGTH }), Type.Null()]),
  extras: Type.Record(Type.String(), Type.Unknown()),
});

export type TopicEntry = Static<typeof TopicEntrySchema>;

export const RegistrySchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  topicManagerAdmins: Type.Array(Type.String()),
  callbackSecret: Type.String(),
  lastDoctorAllRunAt: Type.Union([Type.String(), Type.Null()]),
  autopilotEnabled: Type.Boolean(),
  maxTopics: Type.Integer({ minimum: 1 }),
  topics: Type.Record(Type.String(), TopicEntrySchema),
});

export type Registry = Static<typeof RegistrySchema>;

// ── Doctor Check Result ────────────────────────────────────────────────

export interface DoctorCheckResult {
  severity: Severity;
  checkId: string;
  message: string;
  fixable: boolean;
}

// ── Overlay mappings ───────────────────────────────────────────────────

export const OVERLAY_FILES: Record<TopicType, string[]> = {
  coding: ['ARCHITECTURE.md', 'DEPLOY.md'],
  research: ['SOURCES.md', 'FINDINGS.md'],
  marketing: ['CAMPAIGNS.md', 'METRICS.md'],
  custom: [],
};

export const BASE_FILES = [
  'README.md',
  'STATUS.md',
  'TODO.md',
  'COMMANDS.md',
  'LINKS.md',
  'CRON.md',
  'NOTES.md',
  'LEARNINGS.md',
] as const;

// ── Audit ──────────────────────────────────────────────────────────────

export interface AuditEntry {
  ts: string;
  userId: string;
  cmd: string;
  slug: string;
  detail: string;
}

// ── Inline keyboard types ──────────────────────────────────────────────

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

// ── Shared interfaces ─────────────────────────────────────────────────

export interface RpcInterface {
  call(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

// ── Command types ─────────────────────────────────────────────────────

export interface CommandContext {
  workspaceDir: string;
  configDir: string;
  rpc?: RpcInterface | null;
  logger: Logger;
  groupId?: string;
  threadId?: string;
  userId?: string;
  messageContext?: Record<string, unknown>;
  postFn?: (
    groupId: string,
    threadId: string,
    text: string,
    keyboard?: InlineKeyboardMarkup,
  ) => Promise<void>;
}

export interface CommandResult {
  text: string;
  inlineKeyboard?: InlineKeyboardMarkup;
  pin?: boolean;
}

// ── Helper to build a topic map key ────────────────────────────────────

export function topicKey(groupId: string, threadId: string): string {
  return `${groupId}:${threadId}`;
}

// ── Slug generation ─────────────────────────────────────────────────

/**
 * Generate a stable, immutable slug for a topic.
 * Returns `t-{threadId}` if unique, otherwise `t-{threadId}-{last4OfGroupId}`.
 */
export function generateSlug(
  threadId: string,
  groupId: string,
  existingSlugs: Set<string>,
): string {
  const base = `t-${threadId}`;
  if (!existingSlugs.has(base)) return base;
  const suffix = groupId.replace(/^-/, '').slice(-4);
  return `t-${threadId}-${suffix}`;
}
