import { readRegistry, withRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import { topicKey, MAX_NAME_LENGTH } from '../lib/types.js';
import { buildTopicCard } from '../lib/telegram.js';
import { generateInclude } from '../lib/include-generator.js';
import { triggerRestart, getConfigWrites } from '../lib/config-restart.js';
import { appendAudit, buildAuditEntry } from '../lib/audit.js';
import type { CommandContext, CommandResult } from './help.js';

export async function handleRename(ctx: CommandContext, newName: string): Promise<CommandResult> {
  const { workspaceDir, configDir, userId, groupId, threadId, rpc, logger } = ctx;

  if (!userId || !groupId || !threadId) {
    return { text: 'Missing context: userId, groupId, or threadId not available.' };
  }

  const trimmedName = newName.trim();
  if (!trimmedName) {
    return { text: 'Usage: /tm rename <new-name>' };
  }

  if (trimmedName.length > MAX_NAME_LENGTH) {
    return { text: `Name too long (max ${MAX_NAME_LENGTH} characters).` };
  }

  const registry = readRegistry(workspaceDir);

  // Auth check (admin tier)
  const auth = checkAuthorization(userId, 'rename', registry);
  if (!auth.authorized) {
    return { text: auth.message ?? 'Not authorized.' };
  }

  const key = topicKey(groupId, threadId);
  const entry = registry.topics[key];

  if (!entry) {
    return { text: 'This topic is not registered. Run /tm init first.' };
  }

  const oldName = entry.name;
  if (oldName === trimmedName) {
    return { text: `Topic is already named **${oldName}**.` };
  }

  // Update name in registry (metadata-only, no filesystem changes)
  await withRegistry(workspaceDir, (data) => {
    const topic = data.topics[key];
    if (topic) {
      topic.name = trimmedName;
    }
  });

  // Regenerate include if configWrites enabled (name appears in systemPrompt)
  let restartMsg = '';
  const configWritesEnabled = await getConfigWrites(ctx.rpc);
  if (configWritesEnabled) {
    try {
      const updatedRegistry = readRegistry(workspaceDir);
      generateInclude(workspaceDir, updatedRegistry, configDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      restartMsg = `\nWarning: include generation failed: ${msg}`;
    }
    const result = await triggerRestart(rpc, logger);
    if (!result.success && result.fallbackMessage) {
      restartMsg += '\n' + result.fallbackMessage;
    }
  }

  appendAudit(
    workspaceDir,
    buildAuditEntry(userId, 'rename', entry.slug, `Renamed from "${oldName}" to "${trimmedName}"`),
  );

  const topicCard = buildTopicCard(trimmedName, entry.slug, entry.type, entry.capsuleVersion);

  return {
    text: `Topic renamed from **${oldName}** to **${trimmedName}**.\n\n${topicCard}${restartMsg}`,
  };
}
