import { withRegistry, readRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import { topicKey } from '../lib/types.js';
import { htmlEscape } from '../lib/security.js';
import { appendAudit, buildAuditEntry } from '../lib/audit.js';
import { generateInclude } from '../lib/include-generator.js';
import { triggerRestart, getConfigWrites } from '../lib/config-restart.js';
import type { CommandContext, CommandResult } from './help.js';

export async function handleArchive(ctx: CommandContext): Promise<CommandResult> {
  return handleArchiveToggle(ctx, true);
}

export async function handleUnarchive(ctx: CommandContext): Promise<CommandResult> {
  return handleArchiveToggle(ctx, false);
}

async function handleArchiveToggle(ctx: CommandContext, archive: boolean): Promise<CommandResult> {
  const { workspaceDir, configDir, userId, groupId, threadId, rpc, logger } = ctx;
  const command = archive ? 'archive' : 'unarchive';

  if (!userId || !groupId || !threadId) {
    return { text: 'Missing context: userId, groupId, or threadId not available.' };
  }

  const registry = readRegistry(workspaceDir);

  // Auth check (admin tier)
  const auth = checkAuthorization(userId, command, registry);
  if (!auth.authorized) {
    return { text: auth.message ?? 'Not authorized.' };
  }

  const key = topicKey(groupId, threadId);
  const entry = registry.topics[key];

  if (!entry) {
    return { text: 'This topic is not registered. Run /topic init first.' };
  }

  if (archive && entry.status === 'archived') {
    return { text: `Topic <code>${htmlEscape(entry.slug)}</code> is already archived.` };
  }

  if (!archive && entry.status !== 'archived') {
    return { text: `Topic <code>${htmlEscape(entry.slug)}</code> is not archived.` };
  }

  const newStatus = archive ? 'archived' : 'active';

  await withRegistry(workspaceDir, (data) => {
    const topic = data.topics[key];
    if (topic) {
      topic.status = newStatus;
      if (!archive) {
        topic.snoozeUntil = null;
      }
    }
  });

  // Regenerate include if configWrites enabled
  let restartMsg = '';
  const configWritesEnabled = await getConfigWrites(ctx.rpc);
  if (configWritesEnabled) {
    try {
      const updatedRegistry = readRegistry(workspaceDir);
      generateInclude(workspaceDir, updatedRegistry, configDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      restartMsg = `\nWarning: include generation failed: ${htmlEscape(msg)}`;
    }
    const result = await triggerRestart(rpc, logger);
    if (!result.success && result.fallbackMessage) {
      restartMsg += '\n' + result.fallbackMessage;
    }
  }

  appendAudit(
    workspaceDir,
    buildAuditEntry(userId, command, entry.slug, `Status changed to ${newStatus}`),
  );

  const action = archive ? 'archived' : 'unarchived';
  return {
    text: `Topic <code>${htmlEscape(entry.slug)}</code> ${action}.${restartMsg}`,
    parseMode: 'HTML',
  };
}

