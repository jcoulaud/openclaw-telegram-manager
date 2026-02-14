import type { Registry } from './types.js';

// ── Authorization tiers ────────────────────────────────────────────────

export const AuthTier = {
  User: 'User',
  Admin: 'Admin',
} as const;

export type AuthTier = (typeof AuthTier)[keyof typeof AuthTier];

// ── Command-to-tier mapping ────────────────────────────────────────────

const ADMIN_COMMANDS = new Set([
  'doctor --all',
  'doctor-all',
  'daily-report --all',
  'daily-report-all',
  'list',
  'sync',
  'rename',
  'archive',
  'unarchive',
  'autopilot',
]);

const USER_COMMANDS = new Set([
  'init',
  'doctor',
  'status',
  'help',
  'upgrade',
  'snooze',
]);

/**
 * Get the authorization tier for a command.
 * Defaults to Admin for unknown commands.
 */
export function getCommandTier(command: string): AuthTier {
  const normalized = command.toLowerCase().trim();
  if (USER_COMMANDS.has(normalized)) return AuthTier.User;
  if (ADMIN_COMMANDS.has(normalized)) return AuthTier.Admin;
  // Unknown commands default to admin tier (principle of least privilege)
  return AuthTier.Admin;
}

// ── Authorization check ────────────────────────────────────────────────

export interface AuthResult {
  authorized: boolean;
  message?: string;
}

/**
 * Check if a user is authorized to run a command.
 *
 * Logic:
 * - Admin-tier: user must be in topicManagerAdmins
 * - User-tier: user must be in topicAllowFrom OR topicManagerAdmins
 * - Special case for init: if topicManagerAdmins is empty (first-time setup),
 *   allow anyone — the first user to init becomes the default admin.
 */
export function checkAuthorization(
  userId: string,
  command: string,
  registry: Registry,
  topicAllowFrom?: string[],
): AuthResult {
  const tier = getCommandTier(command);
  const admins = registry.topicManagerAdmins;

  // First-user bootstrap: if no admins set yet, allow anyone for user-tier commands.
  // This covers init (so the first user can set up) and other user-tier commands
  // (status, help, doctor, etc.) that shouldn't be blocked before setup completes.
  if (admins.length === 0 && tier === AuthTier.User) {
    return { authorized: true };
  }

  const isAdmin = admins.includes(userId);

  if (tier === AuthTier.Admin) {
    if (isAdmin) return { authorized: true };
    return {
      authorized: false,
      message: 'Not authorized. Ask a telegram-manager admin to run this command.',
    };
  }

  // User tier: allowed if admin or in topicAllowFrom
  if (isAdmin) return { authorized: true };

  if (topicAllowFrom && topicAllowFrom.includes(userId)) {
    return { authorized: true };
  }

  return {
    authorized: false,
    message: 'Not authorized. Ask a telegram-manager admin to run this command.',
  };
}
