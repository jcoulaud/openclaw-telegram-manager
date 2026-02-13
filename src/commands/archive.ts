import { withRegistry, readRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import { topicKey } from '../lib/types.js';
import { appendAudit, buildAuditEntry } from '../lib/audit.js';
import { generateInclude } from '../lib/include-generator.js';
import { triggerRestart, getConfigWrites } from '../lib/config-restart.js';
import { removeCronJob, registerDailyReportCron } from '../lib/cron.js';
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
    return { text: 'Something went wrong — this command must be run inside a Telegram forum topic.' };
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
    return { text: 'This topic is not registered. Run /tm init first.' };
  }

  if (archive && entry.status === 'archived') {
    return { text: `Topic **${entry.name}** is already archived.` };
  }

  if (!archive && entry.status !== 'archived') {
    return { text: `Topic **${entry.name}** is not archived.` };
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

  // Manage cron job: remove on archive, re-register on unarchive (non-critical)
  if (archive && entry.cronJobId) {
    await removeCronJob(rpc, entry.cronJobId, logger);
    await withRegistry(workspaceDir, (data) => {
      const topic = data.topics[key];
      if (topic) {
        topic.cronJobId = null;
      }
    });
  } else if (!archive && !entry.cronJobId) {
    try {
      const cronResult = await registerDailyReportCron(rpc, {
        topicName: entry.name,
        slug: entry.slug,
        groupId,
        threadId,
      }, logger);
      if (cronResult.jobId) {
        await withRegistry(workspaceDir, (data) => {
          const topic = data.topics[key];
          if (topic) {
            topic.cronJobId = cronResult.jobId;
          }
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[archive] Cron re-registration failed: ${msg}`);
    }
  }

  // Regenerate include file so config stays in sync
  let restartMsg = '';
  try {
    const updatedRegistry = readRegistry(workspaceDir);
    generateInclude(workspaceDir, updatedRegistry, configDir);

    // Only trigger restart if configWrites is enabled
    const configWritesEnabled = await getConfigWrites(ctx.rpc);
    if (configWritesEnabled) {
      const result = await triggerRestart(rpc, logger);
      if (!result.success && result.fallbackMessage) {
        restartMsg = '\n' + result.fallbackMessage;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    restartMsg = `\nWarning: config sync failed: ${msg}`;
  }

  appendAudit(
    workspaceDir,
    buildAuditEntry(userId, command, entry.slug, `Status changed to ${newStatus}`),
  );

  const action = archive ? 'archived' : 'unarchived';
  return {
    text: `Topic **${entry.name}** ${action}.${restartMsg}`,
  };
}

