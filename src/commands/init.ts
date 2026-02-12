import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRegistry, withRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import {
  topicKey,
  generateSlug,
  CAPSULE_VERSION,
  MAX_NAME_LENGTH,
} from '../lib/types.js';
import type { TopicType, TopicEntry } from '../lib/types.js';
import {
  jailCheck,
  rejectSymlink,
  htmlEscape,
  validateGroupId,
  validateThreadId,
} from '../lib/security.js';
import { scaffoldCapsule } from '../lib/capsule.js';
import { buildTopicCard, buildInitTypeButtons } from '../lib/telegram.js';
import { generateInclude } from '../lib/include-generator.js';
import { triggerRestart, getConfigWrites } from '../lib/config-restart.js';
import { appendAudit, buildAuditEntry } from '../lib/audit.js';
import type { CommandContext, CommandResult } from './help.js';

const VALID_TYPES: ReadonlySet<string> = new Set<TopicType>(['coding', 'research', 'marketing', 'custom']);

export async function handleInit(ctx: CommandContext, args: string): Promise<CommandResult> {
  const { workspaceDir, configDir, userId, groupId, threadId, rpc, logger, messageContext } = ctx;

  if (!userId || !groupId || !threadId) {
    return { text: 'Missing context: groupId, threadId, or userId not available. Run this command inside a Telegram forum topic.' };
  }

  // Validate IDs
  if (!validateGroupId(groupId)) {
    return { text: 'Invalid groupId format.' };
  }

  if (!validateThreadId(threadId)) {
    return { text: 'Invalid threadId format.' };
  }

  const registry = readRegistry(workspaceDir);

  // Auth check (user tier, with first-user bootstrap)
  const auth = checkAuthorization(userId, 'init', registry);
  if (!auth.authorized) {
    return { text: auth.message ?? 'Not authorized.' };
  }

  // Max topics check
  const topicCount = Object.keys(registry.topics).length;
  if (topicCount >= registry.maxTopics) {
    return {
      text: `Maximum number of topics (${registry.maxTopics}) reached. Archive or remove existing topics first.`,
    };
  }

  // Check if topic already registered
  const key = topicKey(groupId, threadId);
  if (registry.topics[key]) {
    return {
      text: `This topic is already registered as <b>${htmlEscape(registry.topics[key]!.name)}</b>.`,
      parseMode: 'HTML',
    };
  }

  // Parse args: [name] [type] — detect type as last word if it matches valid types
  const parts = args.trim().split(/\s+/);
  let nameArg = '';
  let topicType: TopicType = 'coding';

  if (parts.length > 0 && parts[parts.length - 1] && VALID_TYPES.has(parts[parts.length - 1]!.toLowerCase())) {
    topicType = parts.pop()!.toLowerCase() as TopicType;
    nameArg = parts.join(' ');
  } else {
    nameArg = parts.join(' ');
  }

  // Derive name: user arg > topicTitle > default
  const topicTitle = (messageContext?.['topicTitle'] as string) ?? '';
  let name: string;

  if (nameArg) {
    name = nameArg;
  } else if (topicTitle) {
    name = topicTitle;
  } else {
    name = `Topic ${threadId}`;
  }

  // Enforce name length
  if (name.length > MAX_NAME_LENGTH) {
    name = name.slice(0, MAX_NAME_LENGTH);
  }

  // Generate stable slug
  const existingSlugs = new Set(Object.values(registry.topics).map((t) => t.slug));
  const finalSlug = generateSlug(threadId, groupId, existingSlugs);

  const projectsBase = path.join(workspaceDir, 'projects');

  // Path jail check
  if (!jailCheck(projectsBase, finalSlug)) {
    return { text: 'Path safety check failed. Slug may escape the projects directory.' };
  }

  // Symlink check on projects base
  if (rejectSymlink(projectsBase)) {
    return { text: 'Projects base is a symlink. Aborting for security.' };
  }

  // Disk collision safety net
  if (fs.existsSync(path.join(projectsBase, finalSlug))) {
    return { text: `Directory projects/${htmlEscape(finalSlug)}/ already exists on disk.` };
  }

  // Symlink check on target path
  const targetPath = path.join(projectsBase, finalSlug);
  if (rejectSymlink(targetPath)) {
    return { text: 'Target path is a symlink. Aborting for security.' };
  }

  // Scaffold capsule and write registry entry atomically under lock
  const isFirstUser = registry.topicManagerAdmins.length === 0;

  try {
    await withRegistry(workspaceDir, (data) => {
      scaffoldCapsule(projectsBase, finalSlug, name, topicType);

      const newEntry: TopicEntry = {
        groupId,
        threadId,
        slug: finalSlug,
        name,
        type: topicType,
        status: 'active',
        capsuleVersion: CAPSULE_VERSION,
        lastMessageAt: new Date().toISOString(),
        lastDoctorReportAt: null,
        lastDoctorRunAt: null,
        snoozeUntil: null,
        ignoreChecks: [],
        consecutiveSilentDoctors: 0,
        lastPostError: null,
        extras: {},
      };

      data.topics[key] = newEntry;

      // First-user bootstrap: add as admin
      if (isFirstUser) {
        data.topicManagerAdmins.push(userId);
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Failed to initialize topic: ${htmlEscape(msg)}` };
  }

  // If configWrites enabled: regenerate include + trigger restart
  let restartMsg = '';
  const configWritesEnabled = await getConfigWrites(ctx.rpc);
  if (configWritesEnabled) {
    try {
      const updatedRegistry = readRegistry(workspaceDir);
      generateInclude(workspaceDir, updatedRegistry, configDir);
      const result = await triggerRestart(rpc, logger);
      if (!result.success && result.fallbackMessage) {
        restartMsg = '\n' + result.fallbackMessage;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      restartMsg = `\nWarning: include generation failed: ${htmlEscape(msg)}`;
    }
  }

  // Audit log
  appendAudit(
    workspaceDir,
    buildAuditEntry(userId, 'init', finalSlug, `Initialized topic name="${name}" type=${topicType} group=${groupId} thread=${threadId}`),
  );

  // Build topic card
  const topicCard = buildTopicCard(name, finalSlug, topicType, CAPSULE_VERSION);

  let adminNote = '';
  if (isFirstUser) {
    adminNote = '\n\nYou are the first user and have been added as a telegram-manager admin.';
  }

  return {
    text: `${topicCard}${adminNote}${restartMsg}`,
    parseMode: 'HTML',
    pin: true,
  };
}

// ── Interactive init flow ─────────────────────────────────────────────

/**
 * Entry point for `/tm init`. If args are provided, delegates straight
 * to `handleInit`. Otherwise shows the type picker directly.
 */
export async function handleInitInteractive(ctx: CommandContext, args: string): Promise<CommandResult> {
  if (args.trim()) {
    return handleInit(ctx, args);
  }
  return buildTypePicker(ctx);
}

/**
 * Show "Pick a topic type:" with 4 type buttons.
 * Validates context, auth, max topics, and already registered before showing.
 */
async function buildTypePicker(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir, userId, groupId, threadId } = ctx;

  if (!userId || !groupId || !threadId) {
    return { text: 'Missing context: groupId, threadId, or userId not available. Run this command inside a Telegram forum topic.' };
  }

  if (!validateGroupId(groupId)) {
    return { text: 'Invalid groupId format.' };
  }
  if (!validateThreadId(threadId)) {
    return { text: 'Invalid threadId format.' };
  }

  const registry = readRegistry(workspaceDir);

  const auth = checkAuthorization(userId, 'init', registry);
  if (!auth.authorized) {
    return { text: auth.message ?? 'Not authorized.' };
  }

  const topicCount = Object.keys(registry.topics).length;
  if (topicCount >= registry.maxTopics) {
    return { text: `Maximum number of topics (${registry.maxTopics}) reached. Archive or remove existing topics first.` };
  }

  const key = topicKey(groupId, threadId);
  if (registry.topics[key]) {
    return {
      text: `This topic is already registered as <b>${htmlEscape(registry.topics[key]!.name)}</b>.`,
      parseMode: 'HTML',
    };
  }

  const keyboard = buildInitTypeButtons(groupId, threadId, registry.callbackSecret);

  return {
    text: 'Pick a topic type:',
    parseMode: 'HTML',
    inlineKeyboard: keyboard,
  };
}

/**
 * Callback handler for type buttons (`ic`/`ir`/`im`/`ix`): complete init with chosen type.
 */
export async function handleInitTypeSelect(ctx: CommandContext, type: TopicType): Promise<CommandResult> {
  return handleInit(ctx, type);
}
