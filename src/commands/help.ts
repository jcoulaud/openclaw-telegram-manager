import { buildHelpCard } from '../lib/telegram.js';
import type { CommandContext, CommandResult } from '../lib/types.js';

export type { CommandContext, CommandResult };

export function handleHelp(_ctx: CommandContext): CommandResult {
  return {
    text: buildHelpCard(),
    parseMode: 'HTML',
  };
}
