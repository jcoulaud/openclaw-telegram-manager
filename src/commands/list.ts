import { readRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import { buildListMessage } from '../lib/telegram.js';
import type { CommandContext, CommandResult } from './help.js';

export async function handleList(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir, userId } = ctx;

  if (!userId) {
    return { text: 'Missing context: userId not available.' };
  }

  const registry = readRegistry(workspaceDir);

  // Auth check (admin tier)
  const auth = checkAuthorization(userId, 'list', registry);
  if (!auth.authorized) {
    return { text: auth.message ?? 'Not authorized.' };
  }

  const topics = Object.values(registry.topics);
  const text = buildListMessage(topics);

  return {
    text,
    parseMode: 'HTML',
  };
}
