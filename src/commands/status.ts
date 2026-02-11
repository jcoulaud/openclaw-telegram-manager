import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import { topicKey } from '../lib/types.js';
import { jailCheck, rejectSymlink, htmlEscape } from '../lib/security.js';
import { truncateMessage } from '../lib/telegram.js';
import type { CommandContext, CommandResult } from './help.js';

export async function handleStatus(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir, userId, groupId, threadId } = ctx;

  if (!userId || !groupId || !threadId) {
    return { text: 'Missing context: userId, groupId, or threadId not available.' };
  }

  const registry = readRegistry(workspaceDir);

  // Auth check (user tier)
  const auth = checkAuthorization(userId, 'status', registry);
  if (!auth.authorized) {
    return { text: auth.message ?? 'Not authorized.' };
  }

  const key = topicKey(groupId, threadId);
  const entry = registry.topics[key];

  if (!entry) {
    return { text: 'This topic is not registered. Run /topic init first.' };
  }

  const projectsBase = path.join(workspaceDir, 'projects');
  const capsuleDir = path.join(projectsBase, entry.slug);

  // Path safety
  if (!jailCheck(projectsBase, entry.slug)) {
    return { text: 'Path safety check failed.' };
  }

  if (rejectSymlink(capsuleDir)) {
    return { text: 'Capsule directory is a symlink. Aborting for security.' };
  }

  const statusPath = path.join(capsuleDir, 'STATUS.md');

  if (!fs.existsSync(statusPath)) {
    return { text: 'STATUS.md not found in capsule. Run /topic doctor to diagnose.' };
  }

  try {
    const content = fs.readFileSync(statusPath, 'utf-8');
    return {
      text: truncateMessage(content),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Failed to read STATUS.md: ${htmlEscape(msg)}` };
  }
}
