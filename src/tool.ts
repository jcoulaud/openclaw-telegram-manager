import { readRegistry, withRegistry } from './lib/registry.js';
import { parseAndVerifyCallback } from './lib/security.js';
import { topicKey, CAPSULE_VERSION } from './lib/types.js';
import type { InlineKeyboardMarkup } from './lib/types.js';
import { appendAudit, buildAuditEntry } from './lib/audit.js';
import { upgradeCapsule } from './lib/capsule.js';
import { handleInitInteractive, handleInitTypeSelect, handleInitNameConfirm } from './commands/init.js';
import { handleDoctor } from './commands/doctor.js';
import { handleDoctorAll } from './commands/doctor-all.js';
import { handleList } from './commands/list.js';
import { handleStatus } from './commands/status.js';
import { handleSync } from './commands/sync.js';
import { handleRename } from './commands/rename.js';
import { handleUpgrade } from './commands/upgrade.js';
import { handleSnooze } from './commands/snooze.js';
import { handleArchive, handleUnarchive } from './commands/archive.js';
import { handleAutopilot } from './commands/autopilot.js';
import { handleDailyReport } from './commands/daily-report.js';
import { handleHelp } from './commands/help.js';
import type { CommandContext, CommandResult } from './commands/help.js';
import type { Logger, RpcInterface } from './lib/config-restart.js';

// ── Dependencies ──────────────────────────────────────────────────────

export interface ToolDeps {
  logger: Logger;
  configDir: string;
  workspaceDir: string;
  rpc?: RpcInterface | null;
  postFn?: (
    groupId: string,
    threadId: string,
    text: string,
    keyboard?: InlineKeyboardMarkup,
  ) => Promise<void>;
}

// ── Tool instance ─────────────────────────────────────────────────────

export interface TopicManagerTool {
  execute(
    _id: string,
    params: { command: string },
    execContext?: Record<string, unknown>,
  ): Promise<CommandResult>;
}

// ── Factory ───────────────────────────────────────────────────────────

export function createTopicManagerTool(deps: ToolDeps): TopicManagerTool {
  const { logger, configDir, workspaceDir, rpc } = deps;

  return {
    async execute(
      _id: string,
      params: { command: string },
      execContext?: Record<string, unknown>,
    ): Promise<CommandResult> {
      const commandStr = (params.command ?? '').trim() || 'help';

      // Extract context from execution params
      const ctx = buildContext(deps, execContext);

      // Handle tm: callback routing (no activity tracking for callbacks)
      if (commandStr.startsWith('tm:')) {
        return handleCallback(commandStr, ctx);
      }

      // Parse sub-command and args
      const { subCommand, args, flags } = parseCommand(commandStr);

      // Activity tracking + auto-upgrade for registered topics (user commands only)
      if (ctx.groupId && ctx.threadId) {
        const key = topicKey(ctx.groupId, ctx.threadId);
        const projectsBase = `${workspaceDir}/projects`;
        void withRegistry(workspaceDir, (data) => {
          const entry = data.topics[key];
          if (!entry) return;

          // Update lastMessageAt
          entry.lastMessageAt = new Date().toISOString();

          // Auto-upgrade capsule if version is behind
          if (entry.capsuleVersion < CAPSULE_VERSION) {
            const oldVersion = entry.capsuleVersion;
            try {
              upgradeCapsule(projectsBase, entry.slug, entry.name, entry.type, entry.capsuleVersion);
              entry.capsuleVersion = CAPSULE_VERSION;
              logger.info(`[auto-upgrade] ${entry.slug} v${oldVersion} → v${CAPSULE_VERSION}`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              logger.error(`[auto-upgrade] ${entry.slug} failed: ${msg}`);
            }
          }
        }).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`[activity-tracking] Failed: ${msg}`);
        });
      }

      try {
        switch (subCommand) {
          case 'init':
            return await handleInitInteractive(ctx, args);

          case 'doctor':
            if (flags.has('--all') || flags.has('all')) {
              return await handleDoctorAll(ctx);
            }
            return await handleDoctor(ctx);

          case 'doctor-all':
            return await handleDoctorAll(ctx);

          case 'list':
            return await handleList(ctx);

          case 'status':
            return await handleStatus(ctx);

          case 'sync':
            return await handleSync(ctx);

          case 'rename':
            return await handleRename(ctx, args);

          case 'upgrade':
            return await handleUpgrade(ctx);

          case 'snooze':
            return await handleSnooze(ctx, args);

          case 'archive':
            return await handleArchive(ctx);

          case 'unarchive':
            return await handleUnarchive(ctx);

          case 'autopilot':
            return await handleAutopilot(ctx, args);

          case 'daily-report':
            return await handleDailyReport(ctx);

          case 'help':
            return await handleHelp(ctx);

          default:
            return {
              text: `Unknown command: "${subCommand}". Try /tm help for available commands.`,
            };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[topic_manager] Command "${subCommand}" failed: ${msg}`);
        return {
          text: `Command failed: ${msg}`,
        };
      }
    },
  };
}

// ── Command parsing ───────────────────────────────────────────────────

interface ParsedCommand {
  subCommand: string;
  args: string;
  flags: Set<string>;
}

function parseCommand(commandStr: string): ParsedCommand {
  const parts = commandStr.split(/\s+/);
  const subCommand = (parts[0] ?? '').toLowerCase();
  const remaining = parts.slice(1);

  const flags = new Set<string>();
  const argParts: string[] = [];

  for (const part of remaining) {
    if (part.startsWith('--')) {
      flags.add(part);
    } else {
      argParts.push(part);
    }
  }

  return {
    subCommand,
    args: argParts.join(' '),
    flags,
  };
}

// ── Context building ────────────────────────────────────────────────

function buildContext(deps: ToolDeps, execContext?: Record<string, unknown>): CommandContext {
  // Extract IDs from the execution context provided by the tool framework
  const groupId = extractString(execContext, 'groupId')
    ?? extractString(execContext, 'chatId')
    ?? extractNestedString(execContext, 'message', 'chat', 'id');

  const threadId = extractString(execContext, 'threadId')
    ?? extractString(execContext, 'messageThreadId')
    ?? extractNestedString(execContext, 'message', 'message_thread_id');

  const userId = extractString(execContext, 'userId')
    ?? extractNestedString(execContext, 'message', 'from', 'id');

  return {
    workspaceDir: deps.workspaceDir,
    configDir: deps.configDir,
    rpc: deps.rpc,
    logger: deps.logger,
    groupId: groupId ?? undefined,
    threadId: threadId ?? undefined,
    userId: userId ?? undefined,
    messageContext: execContext,
    postFn: deps.postFn,
  };
}

function extractString(obj: Record<string, unknown> | undefined, key: string): string | null {
  if (!obj) return null;
  const val = obj[key];
  if (val === undefined || val === null) return null;
  return String(val);
}

function extractNestedString(
  obj: Record<string, unknown> | undefined,
  ...keys: string[]
): string | null {
  if (!obj) return null;
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[key];
  }
  if (current === undefined || current === null) return null;
  return String(current);
}

// ── Callback handling ───────────────────────────────────────────────

async function handleCallback(data: string, ctx: CommandContext): Promise<CommandResult> {
  const { workspaceDir } = ctx;

  // Extract groupId, threadId, and userId from the callback data itself
  // (format: tm:action:groupId:threadId:userId:hmac).
  // This avoids depending on execContext which the gateway doesn't provide
  // for callback queries routed as plain text.
  const cbParts = data.split(':');
  const cbGroupId = cbParts[2];
  const cbThreadId = cbParts[3];

  if (!cbGroupId || !cbThreadId) {
    return { text: 'Cannot verify callback: missing context.' };
  }

  const registry = readRegistry(workspaceDir);
  const parsed = parseAndVerifyCallback(data, registry.callbackSecret, cbGroupId, cbThreadId);

  if (!parsed) {
    return { text: 'Invalid or expired callback.' };
  }

  const { action, userId: cbUserId } = parsed;

  // Init callbacks: topic doesn't exist in registry yet
  const initTypeMap: Record<string, 'coding' | 'research' | 'marketing' | 'custom'> = {
    ic: 'coding',
    ir: 'research',
    im: 'marketing',
    ix: 'custom',
  };

  const initConfirmMap: Record<string, 'coding' | 'research' | 'marketing' | 'custom'> = {
    yc: 'coding',
    yr: 'research',
    ym: 'marketing',
    yx: 'custom',
  };

  // Build a context with callback-derived values so downstream handlers work
  // even when execContext didn't carry them.
  const cbCtx: CommandContext = { ...ctx, groupId: cbGroupId, threadId: cbThreadId, userId: cbUserId };

  if (action in initTypeMap) {
    return handleInitTypeSelect(cbCtx, initTypeMap[action]!);
  }

  if (action in initConfirmMap) {
    return handleInitNameConfirm(cbCtx, initConfirmMap[action]!);
  }

  // Find the topic entry
  const key = topicKey(cbGroupId, cbThreadId);
  const entry = registry.topics[key];

  if (!entry) {
    return { text: 'Topic not found.' };
  }

  switch (action) {
    case 'snooze7d':
      return handleSnooze(cbCtx, '7d');

    case 'snooze30d':
      return handleSnooze(cbCtx, '30d');

    case 'archive':
      return handleArchive(cbCtx);

    default:
      return { text: `Unknown callback action: ${action}` };
  }
}
