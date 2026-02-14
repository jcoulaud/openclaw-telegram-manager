import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRegistry, withRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import { topicKey, DOCTOR_PER_TOPIC_CAP_MS } from '../lib/types.js';
import { jailCheck, rejectSymlink } from '../lib/security.js';
import { buildDoctorReport, buildDoctorButtons } from '../lib/telegram.js';
import { runAllChecksForTopic, backupCapsuleIfHealthy } from '../lib/doctor-checks.js';
import { includePath } from '../lib/include-generator.js';
import type { CommandContext, CommandResult } from './help.js';

export async function handleDoctor(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir, configDir, userId, groupId, threadId } = ctx;

  if (!userId || !groupId || !threadId) {
    return { text: 'Something went wrong — this command must be run inside a Telegram forum topic.' };
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
    return { text: 'This topic is not registered. Run /tm init first.' };
  }

  // Per-topic cooldown: skip if recently checked
  if (entry.lastDoctorReportAt) {
    const elapsed = Date.now() - new Date(entry.lastDoctorReportAt).getTime();
    if (elapsed < DOCTOR_PER_TOPIC_CAP_MS) {
      const remainingHrs = Math.ceil((DOCTOR_PER_TOPIC_CAP_MS - elapsed) / 3_600_000);
      return {
        text: `This topic was checked recently. Next health check available in ~${remainingHrs} hour(s).`,
      };
    }
  }

  const projectsBase = path.join(workspaceDir, 'projects');

  // Path safety
  if (!jailCheck(projectsBase, entry.slug)) {
    return { text: 'Something went wrong — path validation failed.' };
  }

  const capsuleDir = path.join(projectsBase, entry.slug);
  if (rejectSymlink(capsuleDir)) {
    return { text: 'Something went wrong — detected an unsafe file system configuration.' };
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
  const results = runAllChecksForTopic(
    entry,
    projectsBase,
    includeContent,
    registry,
  );

  // Backup if healthy
  backupCapsuleIfHealthy(projectsBase, entry.slug, results);

  // Build report
  const reportText = buildDoctorReport(entry.name, results);

  // Build inline keyboard with HMAC-signed callbacks
  const keyboard = buildDoctorButtons(
    groupId,
    threadId,
    registry.callbackSecret,
    userId,
  );

  // Update lastDoctorReportAt
  await withRegistry(workspaceDir, (data) => {
    const topic = data.topics[key];
    if (topic) {
      topic.lastDoctorReportAt = new Date().toISOString();
    }
  });

  return {
    text: reportText,
    inlineKeyboard: keyboard,
  };
}
