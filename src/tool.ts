import { readRegistry, withRegistry } from './lib/registry.js';
import { parseAndVerifyCallback, htmlEscape } from './lib/security.js';
import { topicKey } from './lib/types.js';
import { appendAudit, buildAuditEntry } from './lib/audit.js';
import { handleInitInteractive, handleInitTypeSelect } from './commands/init.js';
import { handleDoctor } from './commands/doctor.js';
import { handleDoctorAll } from './commands/doctor-all.js';
import { handleList } from './commands/list.js';
import { handleStatus } from './commands/status.js';
import { handleSync } from './commands/sync.js';
import { handleRename } from './commands/rename.js';
import { handleUpgrade } from './commands/upgrade.js';
import { handleSnooze } from './commands/snooze.js';
import { handleArchive, handleUnarchive } from './commands/archive.js';
import { handleHelp } from './commands/help.js';
import type { CommandContext, CommandResult } from './commands/help.js';
import type { Logger, RpcInterface } from './lib/config-restart.js';

// ── Dependencies ──────────────────────────────────────────────────────

export interface ToolDeps {
  logger: Logger;
  configDir: string;
  workspaceDir: string;
  rpc?: RpcInterface | null;
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
      const commandStr = (params.command ?? '').trim();

      if (!commandStr) {
        return { text: 'No command provided. Try /tm help for available commands.' };
      }

      // Extract context from execution params
      const ctx = buildContext(deps, execContext);

      // Handle tm: callback routing
      if (commandStr.startsWith('tm:')) {
        return handleCallback(commandStr, ctx);
      }

      // Parse sub-command and args
      const { subCommand, args, flags } = parseCommand(commandStr);

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

          case 'help':
            return await handleHelp(ctx);

          default:
            return {
              text: `Unknown command: "${htmlEscape(subCommand)}". Try /tm help for available commands.`,
            };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[topic_manager] Command "${subCommand}" failed: ${msg}`);
        return {
          text: `Command failed: ${htmlEscape(msg)}`,
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
  const { workspaceDir, userId } = ctx;

  // Extract groupId and threadId from the callback data itself (format: tm:action:groupId:threadId:hmac).
  // This avoids depending on execContext which may not carry these fields for callback queries.
  const cbParts = data.split(':');
  const cbGroupId = cbParts[2];
  const cbThreadId = cbParts[3];

  if (!cbGroupId || !cbThreadId || !userId) {
    return { text: 'Cannot verify callback: missing context.' };
  }

  const registry = readRegistry(workspaceDir);
  const parsed = parseAndVerifyCallback(data, registry.callbackSecret, cbGroupId, cbThreadId);

  if (!parsed) {
    return { text: 'Invalid or expired callback.' };
  }

  const { action } = parsed;

  // Init callbacks: topic doesn't exist in registry yet
  const initTypeMap: Record<string, 'coding' | 'research' | 'marketing' | 'custom'> = {
    ic: 'coding',
    ir: 'research',
    im: 'marketing',
    ix: 'custom',
  };

  // Build a context with the callback-derived groupId/threadId so downstream
  // handlers have correct values even when execContext didn't carry them.
  const cbCtx: CommandContext = { ...ctx, groupId: cbGroupId, threadId: cbThreadId };

  if (action in initTypeMap) {
    return handleInitTypeSelect(cbCtx, initTypeMap[action]!);
  }

  // Find the topic entry
  const key = topicKey(cbGroupId, cbThreadId);
  const entry = registry.topics[key];

  if (!entry) {
    return { text: 'Topic not found.' };
  }

  switch (action) {
    case 'fix':
      return handleCallbackFix(cbCtx);

    case 'snooze7d':
      return handleSnooze(cbCtx, '7d');

    case 'snooze30d':
      return handleSnooze(cbCtx, '30d');

    case 'archive':
      return handleArchive(cbCtx);

    case 'ignore': {
      // Add the most recent failing check to ignoreChecks
      // For simplicity, we acknowledge the action; the user should specify which check
      return {
        text: `To ignore a specific check, use: /tm snooze or contact an admin. The "Ignore" action requires specifying a check ID.`,
      };
    }

    default:
      return { text: `Unknown callback action: ${htmlEscape(action)}` };
  }
}

async function handleCallbackFix(ctx: CommandContext): Promise<CommandResult> {
  // "Fix" re-runs doctor, which auto-fixes fixable issues
  // For now, doctor itself identifies fixable issues
  const { userId, workspaceDir } = ctx;

  if (userId) {
    appendAudit(
      workspaceDir,
      buildAuditEntry(userId, 'doctor fix', 'callback', 'Fix callback triggered'),
    );
  }

  return handleDoctor(ctx);
}
