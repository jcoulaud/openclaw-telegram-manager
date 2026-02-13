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
  validateGroupId,
  validateThreadId,
} from '../lib/security.js';
import { scaffoldCapsule } from '../lib/capsule.js';
import {
  buildTopicCard,
  buildInitTypeButtons,
  buildInitConfirmButton,
  buildInitWelcomeHtml,
  buildInitNameConfirmHtml,
  buildTopicCardHtml,
} from '../lib/telegram.js';
import { generateInclude } from '../lib/include-generator.js';
import { triggerRestart, getConfigWrites } from '../lib/config-restart.js';
import { appendAudit, buildAuditEntry } from '../lib/audit.js';
import { MARKER_START, HEARTBEAT_BLOCK, HEARTBEAT_FILENAME } from './autopilot.js';
import type { CommandContext, CommandResult } from './help.js';

const VALID_TYPES: ReadonlySet<string> = new Set<TopicType>(['coding', 'research', 'marketing', 'custom']);

function deriveTopicName(
  nameArg: string,
  messageContext: Record<string, unknown> | undefined,
  threadId: string,
): string {
  const topicTitle = (messageContext?.['topicTitle'] as string) ?? '';
  let name: string;

  if (nameArg) {
    name = nameArg;
  } else if (topicTitle) {
    name = topicTitle;
  } else {
    name = `Topic ${threadId}`;
  }

  if (name.length > MAX_NAME_LENGTH) {
    name = name.slice(0, MAX_NAME_LENGTH);
  }

  return name;
}

export async function handleInit(ctx: CommandContext, args: string): Promise<CommandResult> {
  const { workspaceDir, configDir, userId, groupId, threadId, rpc, logger, messageContext } = ctx;

  if (!userId || !groupId || !threadId) {
    return { text: 'Something went wrong — this command must be run inside a Telegram forum topic.' };
  }

  // Validate IDs
  if (!validateGroupId(groupId)) {
    return { text: 'Something went wrong — this doesn\'t look like a valid forum topic.' };
  }

  if (!validateThreadId(threadId)) {
    return { text: 'Something went wrong — this doesn\'t look like a valid forum topic.' };
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
      text: `This topic is already registered as "${registry.topics[key]!.name}".`,
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
  const name = deriveTopicName(nameArg, messageContext, threadId);

  // Generate stable slug
  const existingSlugs = new Set(Object.values(registry.topics).map((t) => t.slug));
  const finalSlug = generateSlug(threadId, groupId, existingSlugs);

  const projectsBase = path.join(workspaceDir, 'projects');

  // Path jail check
  if (!jailCheck(projectsBase, finalSlug)) {
    return { text: 'Setup failed — internal path validation error. Please try again.' };
  }

  // Symlink check on projects base
  if (rejectSymlink(projectsBase)) {
    return { text: 'Setup failed — detected an unsafe file system configuration.' };
  }

  // Disk collision safety net
  if (fs.existsSync(path.join(projectsBase, finalSlug))) {
    return { text: 'A folder for this topic already exists. Run /tm doctor to investigate.' };
  }

  // Symlink check on target path
  const targetPath = path.join(projectsBase, finalSlug);
  if (rejectSymlink(targetPath)) {
    return { text: 'Setup failed — detected an unsafe file system configuration.' };
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
        lastDailyReportAt: null,
        lastCapsuleWriteAt: null,
        snoozeUntil: null,
        consecutiveSilentDoctors: 0,
        lastPostError: null,
        extras: {},
      };

      data.topics[key] = newEntry;

      // First-user bootstrap: add as admin + enable autopilot
      if (isFirstUser) {
        data.topicManagerAdmins.push(userId);
        data.autopilotEnabled = true;
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Failed to initialize topic: ${msg}` };
  }

  // First-user bootstrap: write HEARTBEAT.md (idempotent, non-critical)
  if (isFirstUser) {
    try {
      const heartbeatPath = path.join(workspaceDir, HEARTBEAT_FILENAME);
      let hbContent = '';
      try {
        if (fs.existsSync(heartbeatPath)) {
          hbContent = fs.readFileSync(heartbeatPath, 'utf-8');
        }
      } catch {
        // File doesn't exist — fine
      }

      if (!hbContent.includes(MARKER_START)) {
        const newContent = hbContent
          ? hbContent.trimEnd() + '\n\n' + HEARTBEAT_BLOCK + '\n'
          : HEARTBEAT_BLOCK + '\n';
        const tmpPath = heartbeatPath + '.tmp';
        fs.writeFileSync(tmpPath, newContent, { mode: 0o640 });
        fs.renameSync(tmpPath, heartbeatPath);
      }
    } catch {
      // Non-critical — autopilot can be enabled manually
    }
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
      restartMsg = `\nWarning: config sync failed: ${msg}`;
    }
  }

  // Audit log
  appendAudit(
    workspaceDir,
    buildAuditEntry(userId, 'init', finalSlug, `Initialized topic name="${name}" type=${topicType} group=${groupId} thread=${threadId}`),
  );

  // Build topic card
  const topicCard = buildTopicCard(name, topicType);

  // Direct Telegram posting (bypasses AI reformatting)
  if (ctx.postFn && groupId && threadId) {
    try {
      const htmlCard = buildTopicCardHtml(name, topicType);
      await ctx.postFn(groupId, threadId, htmlCard);
      return { text: '', pin: true };
    } catch {
      // Fall through to markdown fallback
    }
  }

  return {
    text: `${topicCard}${restartMsg}`,
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
    return { text: 'Something went wrong — this command must be run inside a Telegram forum topic.' };
  }

  if (!validateGroupId(groupId)) {
    return { text: 'Something went wrong — this doesn\'t look like a valid forum topic.' };
  }
  if (!validateThreadId(threadId)) {
    return { text: 'Something went wrong — this doesn\'t look like a valid forum topic.' };
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
      text: `This topic is already registered as "${registry.topics[key]!.name}".`,
    };
  }

  const keyboard = buildInitTypeButtons(groupId, threadId, registry.callbackSecret, userId);

  // Direct Telegram posting (bypasses AI reformatting)
  if (ctx.postFn) {
    try {
      await ctx.postFn(groupId, threadId, buildInitWelcomeHtml(), keyboard);
      return { text: 'Topic setup started — pick a type using the buttons above.' };
    } catch {
      // Fall through to markdown fallback
    }
  }

  return {
    text: 'Pick a topic type:',
    inlineKeyboard: keyboard,
  };
}

/**
 * Callback handler for type buttons (`ic`/`ir`/`im`/`ix`): show name confirmation.
 * Re-validates context/auth/max-topics before showing.
 */
export async function handleInitTypeSelect(ctx: CommandContext, type: TopicType): Promise<CommandResult> {
  const { workspaceDir, userId, groupId, threadId, messageContext } = ctx;

  if (!userId || !groupId || !threadId) {
    return { text: 'Something went wrong — this command must be run inside a Telegram forum topic.' };
  }

  if (!validateGroupId(groupId)) {
    return { text: 'Something went wrong — this doesn\'t look like a valid forum topic.' };
  }
  if (!validateThreadId(threadId)) {
    return { text: 'Something went wrong — this doesn\'t look like a valid forum topic.' };
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
      text: `This topic is already registered as "${registry.topics[key]!.name}".`,
    };
  }

  const name = deriveTopicName('', messageContext, threadId);
  const keyboard = buildInitConfirmButton(groupId, threadId, registry.callbackSecret, userId, type);

  // Direct Telegram posting (bypasses AI reformatting)
  if (ctx.postFn) {
    try {
      await ctx.postFn(groupId, threadId, buildInitNameConfirmHtml(name, type), keyboard);
      return { text: `Type selected: ${type}. Confirm the name or type /tm init your-name ${type}.` };
    } catch {
      // Fall through to markdown fallback
    }
  }

  return {
    text: buildInitConfirmMessage(name, type),
    inlineKeyboard: keyboard,
  };
}

/**
 * Callback handler for confirm buttons (`yc`/`yr`/`ym`/`yx`): complete init with chosen type.
 */
export async function handleInitNameConfirm(ctx: CommandContext, type: TopicType): Promise<CommandResult> {
  return handleInit(ctx, type);
}

function buildInitConfirmMessage(name: string, type: TopicType): string {
  return [
    '**Almost there!**',
    '',
    `Name: **${name}**`,
    `Type: ${type}`,
    '',
    'You\'ll see this name in reports and health checks.',
    '',
    `For a custom name: \`/tm init your-name ${type}\``,
  ].join('\n');
}
