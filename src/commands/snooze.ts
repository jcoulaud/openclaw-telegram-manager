import { withRegistry } from '../lib/registry.js';
import { readRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import { topicKey } from '../lib/types.js';
import { appendAudit, buildAuditEntry } from '../lib/audit.js';
import type { CommandContext, CommandResult } from './help.js';

const DURATION_RE = /^(\d+)d$/;

export async function handleSnooze(ctx: CommandContext, args: string): Promise<CommandResult> {
  const { workspaceDir, userId, groupId, threadId } = ctx;

  if (!userId || !groupId || !threadId) {
    return { text: 'Something went wrong — this command must be run inside a Telegram forum topic.' };
  }

  // Parse duration
  const trimmed = args.trim();
  if (!trimmed) {
    return { text: 'How long to snooze? Example: /tm snooze 7d' };
  }

  const match = DURATION_RE.exec(trimmed);
  if (!match) {
    return { text: `Invalid duration "${trimmed}". Use format: 7d, 30d, etc.` };
  }

  const days = parseInt(match[1]!, 10);
  if (days <= 0 || days > 365) {
    return { text: 'Duration must be between 1 and 365 days.' };
  }

  const registry = readRegistry(workspaceDir);

  // Auth check (user tier)
  const auth = checkAuthorization(userId, 'snooze', registry);
  if (!auth.authorized) {
    return { text: auth.message ?? 'Not authorized.' };
  }

  const key = topicKey(groupId, threadId);
  const entry = registry.topics[key];

  if (!entry) {
    return { text: 'This topic is not registered. Run /tm init first.' };
  }

  const snoozeUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  await withRegistry(workspaceDir, (data) => {
    const topic = data.topics[key];
    if (topic) {
      topic.snoozeUntil = snoozeUntil;
      topic.consecutiveSilentDoctors = 0;
      topic.status = 'snoozed';
    }
  });

  appendAudit(
    workspaceDir,
    buildAuditEntry(userId, 'snooze', entry.slug, `Snoozed for ${days} days until ${snoozeUntil}`),
  );

  return {
    text: `Topic **${entry.name}** snoozed for ${days} days. Health checks will resume automatically after that.`,
  };
}
