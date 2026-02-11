import * as fs from 'node:fs';
import * as path from 'node:path';
import { Type } from '@sinclair/typebox';
import { createTopicManagerTool } from './tool.js';

/**
 * Resolve configDir from the plugin's own file path or well-known locations.
 * Plugin is installed at {configDir}/extensions/openclaw-telegram-manager/src/index.ts
 */
function resolveConfigDir(): string | undefined {
  // Try deriving from this file's location
  const thisDir = path.dirname(new URL(import.meta.url).pathname);
  const candidate = path.resolve(thisDir, '..', '..', '..');
  if (
    fs.existsSync(path.join(candidate, 'openclaw.json')) ||
    fs.existsSync(path.join(candidate, 'extensions'))
  ) {
    return candidate;
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

  const tool = createTopicManagerTool({
    logger: api.logger,
    configDir,
    workspaceDir,
    rpc: api.rpc,
  });

  api.registerTool({
    name: 'topic_manager',
    description:
      'Manage Telegram forum topics as deterministic workcells. Sub-commands: init, doctor, list, status, sync, rename, upgrade, snooze, archive, unarchive, help.',
    parameters: Type.Object({
      command: Type.String({
        description:
          "Sub-command and arguments (e.g., 'init', 'doctor --all', 'rename new-slug')",
      }),
    }),
    async execute(
      id: string,
      params: { command: string },
      context?: Record<string, unknown>,
    ) {
      return tool.execute(id, params, context);
    },
  });

  api.logger.info('telegram-manager plugin loaded');
}
