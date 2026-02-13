import { readRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import { generateInclude } from '../lib/include-generator.js';
import { triggerRestart, getConfigWrites } from '../lib/config-restart.js';
import type { CommandContext, CommandResult } from './help.js';

export async function handleSync(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir, configDir, userId, rpc, logger } = ctx;

  if (!userId) {
    return { text: 'Something went wrong — could not identify your user account.' };
  }

  const registry = readRegistry(workspaceDir);

  // Auth check (admin tier)
  const auth = checkAuthorization(userId, 'sync', registry);
  if (!auth.authorized) {
    return { text: auth.message ?? 'Not authorized.' };
  }

  try {
    generateInclude(workspaceDir, registry, configDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `Sync failed: ${msg}`,
    };
  }

  const topicCount = Object.keys(registry.topics).length;

  // Only trigger restart if configWrites is enabled
  const configWritesEnabled = await getConfigWrites(rpc);
  if (configWritesEnabled) {
    const restartResult = await triggerRestart(rpc, logger);
    if (restartResult.success) {
      return { text: `All synced — config updated for ${topicCount} topic(s) and changes are live.` };
    }
  }

  return { text: `Config synced for ${topicCount} topic(s). Restart the gateway to apply changes.` };
}
