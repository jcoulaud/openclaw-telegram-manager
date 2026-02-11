import { Type } from '@sinclair/typebox';
import { createTopicManagerTool } from './tool.js';

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
  const configDir = api.configDir ?? api.pluginConfig?.configDir;
  const workspaceDir = api.workspaceDir ?? api.pluginConfig?.workspaceDir;

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
