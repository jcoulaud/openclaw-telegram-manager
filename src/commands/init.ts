import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRegistry, withRegistry } from '../lib/registry.js';
import { checkAuthorization } from '../lib/auth.js';
import {
  topicKey,
  CAPSULE_VERSION,
} from '../lib/types.js';
import type { TopicType, TopicEntry } from '../lib/types.js';
import {
  validateSlug,
  sanitizeSlug,
  jailCheck,
  rejectSymlink,
  htmlEscape,
  validateGroupId,
  validateThreadId,
  buildCallbackData,
} from '../lib/security.js';
import { scaffoldCapsule } from '../lib/capsule.js';
import { buildTopicCard, buildInitSlugButtons, buildInitTypeButtons } from '../lib/telegram.js';
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
      text: `This topic is already registered as <code>${htmlEscape(registry.topics[key]!.slug)}</code>.`,
      parseMode: 'HTML',
    };
  }

  // Parse args: [slug] [type]
  const parts = args.trim().split(/\s+/);
  let slugArg = parts[0] ?? '';
  let typeArg = parts[1] ?? '';

  // Derive slug from topic title or args
  const topicTitle = (messageContext?.['topicTitle'] as string) ?? '';
  let slug: string;

  if (slugArg) {
    slug = slugArg;
  } else if (topicTitle) {
    slug = sanitizeSlug(topicTitle);
  } else {
    slug = `topic-${threadId}`;
  }

  // Ensure slug starts with a letter (sanitizeSlug may produce something starting with a digit)
  if (slug && !/^[a-z]/.test(slug)) {
    slug = 't-' + slug;
  }

  // Validate slug
  if (!validateSlug(slug)) {
    return {
      text: `Invalid slug "${htmlEscape(slug)}". Must start with a letter, lowercase alphanumeric + hyphens, max 50 chars.`,
    };
  }

  // Determine type
  let topicType: TopicType = 'coding';
  if (typeArg && VALID_TYPES.has(typeArg.toLowerCase())) {
    topicType = typeArg.toLowerCase() as TopicType;
  }

  const projectsBase = path.join(workspaceDir, 'projects');

  // Path jail check
  if (!jailCheck(projectsBase, slug)) {
    return { text: 'Path safety check failed. Slug may escape the projects directory.' };
  }

  // Symlink check on projects base
  if (rejectSymlink(projectsBase)) {
    return { text: 'Projects base is a symlink. Aborting for security.' };
  }

  // Collision detection (registry)
  const slugInUse = Object.values(registry.topics).some((t) => t.slug === slug);
  const diskExists = fs.existsSync(path.join(projectsBase, slug));

  let finalSlug = slug;
  if (slugInUse || diskExists) {
    // Append last 4 chars of groupId for uniqueness
    const suffix = groupId.replace(/^-/, '').slice(-4);
    finalSlug = `${slug}-${suffix}`.slice(0, 50);

    if (!validateSlug(finalSlug)) {
      return { text: `Could not generate a unique slug. Please provide one: /topic init &lt;slug&gt; [type]` };
    }

    // Check the fallback slug too
    const fallbackInUse = Object.values(registry.topics).some((t) => t.slug === finalSlug);
    if (fallbackInUse) {
      return {
        text: `Both <code>${htmlEscape(slug)}</code> and <code>${htmlEscape(finalSlug)}</code> are taken. Please provide a unique slug: /topic init &lt;slug&gt; [type]`,
        parseMode: 'HTML',
      };
    }

    // Re-check jail for fallback slug
    if (!jailCheck(projectsBase, finalSlug)) {
      return { text: 'Path safety check failed for fallback slug.' };
    }
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
      scaffoldCapsule(projectsBase, finalSlug, topicType);

      const newEntry: TopicEntry = {
        groupId,
        threadId,
        slug: finalSlug,
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
    buildAuditEntry(userId, 'init', finalSlug, `Initialized topic type=${topicType} group=${groupId} thread=${threadId}`),
  );

  // Build topic card
  const topicCard = buildTopicCard(finalSlug, topicType, CAPSULE_VERSION);

  let adminNote = '';
  if (isFirstUser) {
    adminNote = '\n\nYou are the first user and have been added as a telegram-manager admin.';
  }

  let slugNote = '';
  if (finalSlug !== slug) {
    slugNote = `\n\nNote: slug <code>${htmlEscape(slug)}</code> was taken, using <code>${htmlEscape(finalSlug)}</code> instead.`;
  }

  return {
    text: `${topicCard}${slugNote}${adminNote}${restartMsg}`,
    parseMode: 'HTML',
    pin: true,
  };
}

// ── Callback data byte limit ──────────────────────────────────────────

const CALLBACK_BYTE_LIMIT = 64;

/**
 * Check whether a callback payload for the given slug fits within
 * Telegram's 64-byte callback_data limit.
 */
function fitsCallbackLimit(action: string, slug: string, groupId: string, threadId: string, secret: string): boolean {
  const data = buildCallbackData(action, slug, groupId, threadId, secret);
  return Buffer.byteLength(data, 'utf-8') <= CALLBACK_BYTE_LIMIT;
}

// ── Interactive init flow ─────────────────────────────────────────────

const INIT_TYPE_MAP: Record<string, TopicType> = {
  ic: 'coding',
  ir: 'research',
  im: 'marketing',
  ix: 'custom',
};

/**
 * Entry point for `/topic init`. If args are provided, delegates straight
 * to `handleInit`. Otherwise starts the interactive two-step flow.
 */
export async function handleInitInteractive(ctx: CommandContext, args: string): Promise<CommandResult> {
  if (args.trim()) {
    return handleInit(ctx, args);
  }
  return buildSlugConfirmation(ctx);
}

/**
 * Step 1: derive slug and present a [Confirm] inline button.
 * Falls back to text instructions if the callback data would exceed 64 bytes.
 */
async function buildSlugConfirmation(ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir, userId, groupId, threadId, messageContext } = ctx;

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
      text: `This topic is already registered as <code>${htmlEscape(registry.topics[key]!.slug)}</code>.`,
      parseMode: 'HTML',
    };
  }

  // Derive slug (same logic as handleInit lines 74–96)
  const topicTitle = (messageContext?.['topicTitle'] as string) ?? '';
  let slug: string;
  if (topicTitle) {
    slug = sanitizeSlug(topicTitle);
  } else {
    slug = `topic-${threadId}`;
  }
  if (slug && !/^[a-z]/.test(slug)) {
    slug = 't-' + slug;
  }
  if (!validateSlug(slug)) {
    return {
      text: `Invalid derived slug "${htmlEscape(slug)}". Please provide one: /topic init &lt;slug&gt; [type]`,
    };
  }

  // Check callback byte limit — if slug is too long, fall back to text
  if (!fitsCallbackLimit('is', slug, groupId, threadId, registry.callbackSecret)) {
    return {
      text: `Suggested slug: <code>${htmlEscape(slug)}</code>\n\nSlug is too long for inline buttons. Please run:\n<code>/topic init ${htmlEscape(slug)} [type]</code>`,
      parseMode: 'HTML',
    };
  }

  const keyboard = buildInitSlugButtons(slug, groupId, threadId, registry.callbackSecret);

  return {
    text: `Initialize this topic as <code>${htmlEscape(slug)}</code>?`,
    parseMode: 'HTML',
    inlineKeyboard: keyboard,
  };
}

/**
 * Step 2 (callback `is`): re-validate, then show the type picker.
 */
export async function handleInitSlugConfirm(ctx: CommandContext, slug: string): Promise<CommandResult> {
  const { workspaceDir, userId, groupId, threadId } = ctx;

  if (!userId || !groupId || !threadId) {
    return { text: 'Missing context.' };
  }

  const registry = readRegistry(workspaceDir);

  const auth = checkAuthorization(userId, 'init', registry);
  if (!auth.authorized) {
    return { text: auth.message ?? 'Not authorized.' };
  }

  const key = topicKey(groupId, threadId);
  if (registry.topics[key]) {
    return {
      text: `This topic is already registered as <code>${htmlEscape(registry.topics[key]!.slug)}</code>.`,
      parseMode: 'HTML',
    };
  }

  const keyboard = buildInitTypeButtons(slug, groupId, threadId, registry.callbackSecret);

  return {
    text: `Slug: <code>${htmlEscape(slug)}</code>\n\nPick a topic type:`,
    parseMode: 'HTML',
    inlineKeyboard: keyboard,
  };
}

/**
 * Step 3 (callbacks `ic`/`ir`/`im`/`ix`): complete init with chosen type.
 */
export async function handleInitTypeSelect(ctx: CommandContext, slug: string, type: TopicType): Promise<CommandResult> {
  return handleInit(ctx, `${slug} ${type}`);
}

