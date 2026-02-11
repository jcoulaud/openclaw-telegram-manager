import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRegistry, withRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import { topicKey } from '../lib/types.js';
import { jailCheck, rejectSymlink } from '../lib/security.js';
import { buildDoctorReport, buildDoctorButtons } from '../lib/telegram.js';
import { runAllChecksForTopic } from '../lib/doctor-checks.js';
import { includePath } from '../lib/include-generator.js';
import type { CommandContext, CommandResult } from './help.js';

export async function handleDoctor(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir, configDir, userId, groupId, threadId } = ctx;

  if (!userId || !groupId || !threadId) {
    return { text: 'Missing context: userId, groupId, or threadId not available.' };
  }

  const registry = readRegistry(workspaceDir);

  // Auth check (user tier)
  const auth = checkAuthorization(userId, 'doctor', registry);
  if (!auth.authorized) {
    return { text: auth.message ?? 'Not authorized.' };
  }

  const key = topicKey(groupId, threadId);
  const entry = registry.topics[key];

  if (!entry) {
    return { text: 'This topic is not registered. Run /topic init first.' };
  }

  const projectsBase = path.join(workspaceDir, 'projects');

  // Path safety
  if (!jailCheck(projectsBase, entry.slug)) {
    return { text: 'Path safety check failed.' };
  }

  const capsuleDir = path.join(projectsBase, entry.slug);
  if (rejectSymlink(capsuleDir)) {
    return { text: 'Capsule directory is a symlink. Aborting for security.' };
  }

  // Read include content for config checks (optional)
  let includeContent: string | undefined;
  const incPath = includePath(configDir);
  try {
    if (fs.existsSync(incPath)) {
      includeContent = fs.readFileSync(incPath, 'utf-8');
    }
  } catch {
    // Not critical
  }

  // Run all checks
  const cronJobsPath = path.join(configDir, 'cron', 'jobs.json');
  const results = runAllChecksForTopic(
    entry,
    projectsBase,
    includeContent,
    registry,
    cronJobsPath,
  );

  // Build report
  const reportText = buildDoctorReport(entry.slug, results);

  // Build inline keyboard with HMAC-signed callbacks
  const keyboard = buildDoctorButtons(
    entry.slug,
    groupId,
    threadId,
    registry.callbackSecret,
  );

  // Append text command equivalents
  const textCommands = [
    '',
    'Or use text commands:',
    '/topic snooze 7d',
    '/topic snooze 30d',
    '/topic archive',
  ].join('\n');

  // Update lastDoctorReportAt
  await withRegistry(workspaceDir, (data) => {
    const topic = data.topics[key];
    if (topic) {
      topic.lastDoctorReportAt = new Date().toISOString();
    }
  });

  return {
    text: reportText + textCommands,
    parseMode: 'HTML',
    inlineKeyboard: keyboard,
  };
}
