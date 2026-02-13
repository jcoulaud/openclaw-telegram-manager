import * as fs from 'node:fs';
import * as path from 'node:path';
import { Type } from '@sinclair/typebox';
import { createTopicManagerTool } from './tool.js';

/**
 * Resolve configDir from the plugin's own file path or well-known locations.
 * Plugin is installed at {configDir}/extensions/openclaw-telegram-manager/dist/plugin.js
 * (or .../src/index.ts during development).
 */
function resolveConfigDir(): string | undefined {
  // Try deriving from this file's location by finding the "extensions" segment
  const thisFile = new URL(import.meta.url).pathname;
  const parts = thisFile.split(path.sep);
  const extIndex = parts.lastIndexOf('extensions');
  if (extIndex > 0) {
    const candidate = parts.slice(0, extIndex).join(path.sep);
    if (
      fs.existsSync(path.join(candidate, 'openclaw.json')) ||
      fs.existsSync(path.join(candidate, 'extensions'))
    ) {
      return candidate;
    }
  }

  // Fall back to env / home directory
  const envDir = process.env['OPENCLAW_CONFIG_DIR'];
  if (envDir && fs.existsSync(envDir)) return path.resolve(envDir);

  const homeDir = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  const defaultDir = path.join(homeDir, '.openclaw');
  if (fs.existsSync(defaultDir)) return defaultDir;

  return undefined;
}

export default function register(api: {
  logger: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  configDir?: string;
  workspaceDir?: string;
  rpc?: { call(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> } | null;
  pluginConfig?: { configDir?: string; workspaceDir?: string };
  registerTool(def: {
    name: string;
    description: string;
    parameters: unknown;
    execute(id: string, params: { command: string }, context?: Record<string, unknown>): Promise<unknown>;
  }): void;
  registerCommand?(def: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    requireAuth?: boolean;
    handler(ctx: {
      args: string;
      commandBody: string;
      senderId?: string;
      from?: string;
      channel?: string;
      isAuthorizedSender?: boolean;
      config?: Record<string, unknown>;
      // Telegram-specific (undocumented but present at runtime per gateway source)
      messageThreadId?: string | number;
    }): Promise<{
      text?: string;
      channelData?: { telegram?: { buttons?: unknown } };
    }>;
  }): void;
}): void {
  const resolvedConfigDir = resolveConfigDir();
  const configDir = api.configDir ?? api.pluginConfig?.configDir ?? resolvedConfigDir;
  const workspaceDir =
    api.workspaceDir ??
    api.pluginConfig?.workspaceDir ??
    (resolvedConfigDir ? path.join(resolvedConfigDir, 'workspace') : undefined);

  if (!configDir || !workspaceDir) {
    api.logger.error(
      'telegram-manager: configDir or workspaceDir not available. Plugin cannot initialize.',
    );
    return;
  }

  // Resolve postFn for direct Telegram posting.
  // The function lives on api.runtime.channel.telegram.sendMessageTelegram.
  type PostFn = (
    groupId: string,
    threadId: string,
    text: string,
    keyboard?: { inline_keyboard: { text: string; callback_data: string }[][] },
  ) => Promise<void>;

  let resolvedPostFn: PostFn | null = null;

  // Try wiring via runtime (available immediately, no dynamic import needed)
  const rt = (api as Record<string, unknown>).runtime as Record<string, unknown> | undefined;
  const tgChannel = (rt?.channel as Record<string, unknown> | undefined)?.telegram as Record<string, unknown> | undefined;
  const sendFn = tgChannel?.sendMessageTelegram;
  if (typeof sendFn === 'function') {
    const sendMsg = sendFn as (
      chatId: string,
      text: string,
      opts?: Record<string, unknown>,
    ) => Promise<unknown>;
    resolvedPostFn = async (gId, tId, txt, kb) => {
      const opts: Record<string, unknown> = {
        messageThreadId: Number(tId),
        textMode: 'html',
      };
      if (kb) opts.buttons = kb.inline_keyboard;
      await sendMsg(gId, txt, opts);
    };
    api.logger.info('telegram-manager: postFn wired via runtime.channel.telegram');
  } else {
    api.logger.warn('telegram-manager: runtime.channel.telegram.sendMessageTelegram not available — direct posting disabled');
  }

  const postFn: PostFn | undefined = resolvedPostFn ?? undefined;

  const tool = createTopicManagerTool({
    logger: api.logger,
    configDir,
    workspaceDir,
    rpc: api.rpc,
    postFn,
  });

  api.registerTool({
    name: 'topic_manager',
    description:
      'Manage Telegram forum topics with persistent memory. Sub-commands: init, doctor, list, status, sync, rename, upgrade, snooze, archive, unarchive, autopilot, help.',
    parameters: Type.Object({
      command: Type.String({
        description:
          "Sub-command and arguments (e.g., 'init', 'doctor --all', 'rename new-name')",
      }),
    }),
    async execute(
      id: string,
      params: { command: string },
      context?: Record<string, unknown>,
    ) {
      const result = await tool.execute(id, params, context);
      // Wrap in AgentToolResult format so the gateway's extractTextFromToolResult
      // can find the text (it looks for .content, not .text).
      // Also forward inlineKeyboard via channelData so callback responses
      // (which bypass registerCommand) can still render buttons.
      const response: Record<string, unknown> = {
        content: [{ type: 'text' as const, text: result.text }],
      };
      if (result.inlineKeyboard) {
        response.channelData = {
          telegram: { buttons: result.inlineKeyboard.inline_keyboard },
        };
      }
      return response;
    },
  });

  // Register a plugin command so the gateway passes full message context
  // (senderId, channel, messageThreadId). Skill command dispatch doesn't
  // forward this context, which causes "Missing context" errors for /tm init.
  if (api.registerCommand) {
    api.registerCommand({
      name: 'tm',
      description:
        'Manage Telegram forum topics with persistent memory. Sub-commands: init, doctor, list, status, sync, rename, upgrade, snooze, archive, unarchive, autopilot, help.',
      acceptsArgs: true,
      requireAuth: false,
      async handler(ctx) {
        const userId = ctx.senderId;
        // ctx.from contains the full group identifier (e.g. "telegram:group:-100123:topic:1").
        // Strip common prefixes to extract the numeric chat ID.
        const groupId = ctx.from
          ?.replace(/^telegram:(?:group:)?/, '')
          .split(':topic:')[0]
          || undefined;
        // messageThreadId is present at runtime for Telegram forum topics
        // (confirmed in gateway source) but not yet in the public docs.
        const threadId =
          ctx.messageThreadId != null ? String(ctx.messageThreadId) : undefined;

        // Best-effort topicTitle extraction from gateway context
        const topicTitle =
          (ctx as Record<string, unknown>)['topicTitle'] ??
          (ctx as Record<string, unknown>)['topicName'];

        const execContext: Record<string, unknown> = {};
        if (userId) execContext.userId = userId;
        if (groupId) execContext.groupId = groupId;
        if (threadId) execContext.threadId = threadId;
        if (topicTitle != null) execContext.topicTitle = String(topicTitle);

        const result = await tool.execute('cmd', { command: ctx.args }, execContext);

        const reply: { text?: string; channelData?: { telegram?: { buttons?: unknown } } } = {
          text: result.text,
        };
        if (result.inlineKeyboard) {
          // OpenClaw expects the raw 2D button array, not the InlineKeyboardMarkup wrapper
          reply.channelData = { telegram: { buttons: result.inlineKeyboard.inline_keyboard } };
        }
        return reply;
      },
    });
  }

  api.logger.info('telegram-manager plugin loaded');
}
