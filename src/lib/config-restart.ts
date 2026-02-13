// ── Config restart via config.patch no-op ──────────────────────────────
//
// Triggers Gateway restart by patching a no-op value, which causes
// OpenClaw to reload all $include files.

// ── Types ──────────────────────────────────────────────────────────────

import type { RpcInterface, Logger } from './types.js';

export type { RpcInterface, Logger };

export interface RestartResult {
  success: boolean;
  fallbackMessage?: string;
}

// ── Cooldown tracking (module-level) ───────────────────────────────────

const COOLDOWN_MS = 60_000; // 60 seconds
let lastRestartTimestamp = 0;

// ── Backoff config ─────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1s, 2s, 4s exponential backoff

// ── Main function ──────────────────────────────────────────────────────

/**
 * Trigger a Gateway restart via config.patch no-op.
 *
 * - Enforces a 60-second cooldown between calls
 * - Retries up to 3 times on baseHash mismatch with exponential backoff
 * - Falls back to a user message if RPC is unavailable
 */
export async function triggerRestart(
  rpc: RpcInterface | null | undefined,
  logger: Logger,
): Promise<RestartResult> {
  // Cooldown check
  const now = Date.now();
  if (now - lastRestartTimestamp < COOLDOWN_MS) {
    const remainingSec = Math.ceil((COOLDOWN_MS - (now - lastRestartTimestamp)) / 1000);
    logger.info(`Config restart cooldown active. ${remainingSec}s remaining.`);
    return {
      success: true, // Not a failure — just throttled
    };
  }

  // If RPC is not available, return fallback
  if (!rpc) {
    return {
      success: false,
      fallbackMessage: 'Restart the gateway to apply changes.',
    };
  }

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Get current config to capture baseHash
      const configResult = await rpc.call('config.get', {});
      const baseHash = configResult['baseHash'] as string | undefined;

      if (!baseHash) {
        logger.warn('config.get did not return baseHash; attempting patch without it');
      }

      // Patch with no-op change to trigger restart
      const patchParams: Record<string, unknown> = {
        patch: {
          skills: {
            entries: {
              'telegram-manager': {
                lastSync: new Date().toISOString(),
              },
            },
          },
        },
      };

      if (baseHash) {
        patchParams['baseHash'] = baseHash;
      }

      await rpc.call('config.patch', patchParams);

      // Success — update cooldown timestamp
      lastRestartTimestamp = Date.now();
      logger.info('Gateway restart triggered via config.patch');

      return { success: true };
    } catch (err: unknown) {
      const isBaseHashMismatch = isHashMismatchError(err);

      if (isBaseHashMismatch && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        logger.warn(
          `config.patch baseHash mismatch (attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying in ${delay}ms...`,
        );
        await sleep(delay);
        continue;
      }

      // All retries exhausted or non-retryable error
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`config.patch failed after ${attempt + 1} attempt(s): ${errMsg}`);

      return {
        success: false,
        fallbackMessage: 'Restart the gateway to apply changes.',
      };
    }
  }

  // Should not reach here, but just in case
  return {
    success: false,
    fallbackMessage: 'Restart the gateway to apply changes.',
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function isHashMismatchError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    // Check for common error shape
    if ('code' in err && (err as { code: string }).code === 'BASE_HASH_MISMATCH') {
      return true;
    }
    if ('message' in err) {
      const msg = (err as { message: string }).message;
      return msg.toLowerCase().includes('basehash') || msg.toLowerCase().includes('hash mismatch');
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if configWrites is enabled in the plugin config via RPC.
 */
export async function getConfigWrites(rpc: RpcInterface | null | undefined): Promise<boolean> {
  if (!rpc) return false;
  try {
    const config = await rpc.call('config.get', {});
    const skills = config['skills'] as Record<string, unknown> | undefined;
    const entries = skills?.['entries'] as Record<string, unknown> | undefined;
    const tmConfig = entries?.['telegram-manager'] as Record<string, unknown> | undefined;
    return tmConfig?.['configWrites'] === true;
  } catch {
    return false;
  }
}

/**
 * Reset the cooldown timer (for testing purposes).
 */
export function resetCooldown(): void {
  lastRestartTimestamp = 0;
}
