import * as path from 'node:path';
import { readRegistry, withRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import { topicKey, CAPSULE_VERSION } from '../lib/types.js';
import { htmlEscape } from '../lib/security.js';
import { upgradeCapsule } from '../lib/capsule.js';
import type { CommandContext, CommandResult } from './help.js';

export async function handleUpgrade(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir, userId, groupId, threadId } = ctx;

  if (!userId || !groupId || !threadId) {
    return { text: 'Missing context: userId, groupId, or threadId not available.' };
  }

  const registry = readRegistry(workspaceDir);

  // Auth check (user tier)
  const auth = checkAuthorization(userId, 'upgrade', registry);
  if (!auth.authorized) {
    return { text: auth.message ?? 'Not authorized.' };
  }

  const key = topicKey(groupId, threadId);
  const entry = registry.topics[key];

  if (!entry) {
    return { text: 'This topic is not registered. Run /tm init first.' };
  }

  if (entry.capsuleVersion >= CAPSULE_VERSION) {
    return {
      text: `Topic <code>${htmlEscape(entry.slug)}</code> is already at capsule version ${CAPSULE_VERSION}. No upgrade needed.`,
      parseMode: 'HTML',
    };
  }

  const projectsBase = path.join(workspaceDir, 'projects');
  const result = upgradeCapsule(projectsBase, entry.slug, entry.type, entry.capsuleVersion);

  if (!result.upgraded) {
    return {
      text: `No upgrade needed for <code>${htmlEscape(entry.slug)}</code>.`,
      parseMode: 'HTML',
    };
  }

  // Update capsule version in registry
  await withRegistry(workspaceDir, (data) => {
    const topic = data.topics[key];
    if (topic) {
      topic.capsuleVersion = result.newVersion;
    }
  });

  const addedList = result.addedFiles.length > 0
    ? `\nAdded files: ${result.addedFiles.map((f) => htmlEscape(f)).join(', ')}`
    : '\nNo new files added.';

  return {
    text: `Topic <code>${htmlEscape(entry.slug)}</code> upgraded from v${entry.capsuleVersion} to v${result.newVersion}.${addedList}`,
    parseMode: 'HTML',
  };
}
