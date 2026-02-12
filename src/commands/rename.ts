import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRegistry, withRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import { topicKey } from '../lib/types.js';
import { validateSlug, jailCheck, rejectSymlink, htmlEscape } from '../lib/security.js';
import { buildTopicCard } from '../lib/telegram.js';
import { generateInclude } from '../lib/include-generator.js';
import { triggerRestart, getConfigWrites } from '../lib/config-restart.js';
import { appendAudit, buildAuditEntry } from '../lib/audit.js';
import type { CommandContext, CommandResult } from './help.js';

export async function handleRename(ctx: CommandContext, newSlug: string): Promise<CommandResult> {
  const { workspaceDir, configDir, userId, groupId, threadId, rpc, logger } = ctx;

  if (!userId || !groupId || !threadId) {
    return { text: 'Missing context: userId, groupId, or threadId not available.' };
  }

  const trimmedSlug = newSlug.trim();
  if (!trimmedSlug) {
    return { text: 'Usage: /tm rename &lt;new-slug&gt;' };
  }

  // Validate new slug
  if (!validateSlug(trimmedSlug)) {
    return {
      text: `Invalid slug "${htmlEscape(trimmedSlug)}". Must match: lowercase letter start, alphanumeric + hyphens, max 50 chars.`,
    };
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

  const oldSlug = entry.slug;
  if (oldSlug === trimmedSlug) {
    return { text: `Topic is already named <code>${htmlEscape(oldSlug)}</code>.` };
  }

  const projectsBase = path.join(workspaceDir, 'projects');

  // Path jail check for both old and new paths
  if (!jailCheck(projectsBase, oldSlug)) {
    return { text: 'Path safety check failed for current slug.' };
  }

  if (!jailCheck(projectsBase, trimmedSlug)) {
    return { text: 'Path safety check failed for new slug.' };
  }

  const oldPath = path.join(projectsBase, oldSlug);
  const newPath = path.join(projectsBase, trimmedSlug);

  // Symlink check on both paths
  if (rejectSymlink(oldPath)) {
    return { text: 'Current capsule directory is a symlink. Aborting for security.' };
  }

  if (rejectSymlink(newPath)) {
    return { text: 'Target capsule directory is a symlink. Aborting for security.' };
  }

  // Collision check: new slug in registry
  const collisionInRegistry = Object.values(registry.topics).some((t) => t.slug === trimmedSlug);
  if (collisionInRegistry) {
    return {
      text: `Slug <code>${htmlEscape(trimmedSlug)}</code> is already used by another topic.`,
      parseMode: 'HTML',
    };
  }

  // Collision check: new path on disk
  if (fs.existsSync(newPath)) {
    return {
      text: `Directory projects/${htmlEscape(trimmedSlug)}/ already exists on disk.`,
      parseMode: 'HTML',
    };
  }

  // Rename folder on disk
  if (!fs.existsSync(oldPath)) {
    return { text: `Source capsule directory not found: projects/${htmlEscape(oldSlug)}/` };
  }

  // Rename folder and update registry atomically under lock
  try {
    await withRegistry(workspaceDir, (data) => {
      const topic = data.topics[key];
      if (topic) {
        fs.renameSync(oldPath, newPath);
        topic.slug = trimmedSlug;
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Failed to rename capsule: ${htmlEscape(msg)}` };
  }

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
    buildAuditEntry(userId, 'rename', trimmedSlug, `Renamed from ${oldSlug} to ${trimmedSlug}`),
  );

  const topicCard = buildTopicCard(trimmedSlug, entry.type, entry.capsuleVersion);

  return {
    text: `Topic renamed from <code>${htmlEscape(oldSlug)}</code> to <code>${htmlEscape(trimmedSlug)}</code>.\n\n${topicCard}${restartMsg}`,
    parseMode: 'HTML',
  };
}

