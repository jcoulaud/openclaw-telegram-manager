import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Path safety ────────────────────────────────────────────────────────

/**
 * Jail check: ensure `userPath` resolves within `base`.
 * Returns true if safe, false if the path escapes the base.
 */
export function jailCheck(base: string, userPath: string): boolean {
  const resolved = path.resolve(base, userPath);
  const normalizedBase = path.resolve(base) + path.sep;
  return resolved.startsWith(normalizedBase) || resolved === path.resolve(base);
}

/**
 * Reject symlinks. Returns true if the path is a symlink (should be rejected).
 * Returns false if not a symlink or path does not exist.
 */
export function rejectSymlink(filePath: string): boolean {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

// ── HMAC signing / verification ────────────────────────────────────────

/**
 * Sign a payload with HMAC-SHA256, returning the first 16 hex chars.
 * Truncated to 8 bytes (16 hex chars) to fit within Telegram's 64-byte
 * callback_data limit. Online brute-force is infeasible due to Telegram rate limits.
 */
export function hmacSign(secret: string, payload: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Verify an HMAC signature using constant-time comparison.
 * Returns true if the signature is valid.
 */
export function hmacVerify(secret: string, payload: string, signature: string): boolean {
  const expected = hmacSign(secret, payload);
  if (expected.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signature, 'utf8'),
    );
  } catch {
    return false;
  }
}

// ── HTML escaping ──────────────────────────────────────────────────────

const HTML_ESCAPE_MAP: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
};

/** Escape HTML special characters for safe Telegram HTML output. */
export function htmlEscape(str: string): string {
  return str.replace(/[<>&"]/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

// ── ID validation ──────────────────────────────────────────────────────

const GROUP_ID_RE = /^-?\d+$/;
const THREAD_ID_RE = /^\d+$/;

/** Validate a Telegram group ID (may be negative). */
export function validateGroupId(id: string): boolean {
  return GROUP_ID_RE.test(id);
}

/** Validate a Telegram thread ID (positive integer). */
export function validateThreadId(id: string): boolean {
  return THREAD_ID_RE.test(id);
}

// ── Callback data handling ─────────────────────────────────────────────

const CALLBACK_RE = /^tm:[a-z0-9]+:-?\d+:\d+:\d+:[a-f0-9]+$/;

export interface CallbackData {
  action: string;
  groupId: string;
  threadId: string;
  userId: string;
}

/**
 * Build callback data string with HMAC signature.
 * Format: tm:<action>:<groupId>:<threadId>:<userId>:<hmac>
 *
 * userId is embedded so callbacks work even when the gateway doesn't pass
 * execution context (e.g. callback queries routed as plain text).
 */
export function buildCallbackData(
  action: string,
  groupId: string,
  threadId: string,
  secret: string,
  userId: string,
): string {
  const payload = `tm:${action}:${groupId}:${threadId}:${userId}`;
  const sig = hmacSign(secret, payload);
  return `${payload}:${sig}`;
}

/**
 * Parse and verify callback data.
 * Returns the parsed data or null if verification fails.
 *
 * Checks:
 * 1. Format matches the expected regex
 * 2. HMAC is valid
 * 3. groupId and threadId match the expected values (prevents cross-topic tampering)
 */
export function parseAndVerifyCallback(
  data: string,
  secret: string,
  contextGroupId: string,
  contextThreadId: string,
): CallbackData | null {
  if (!CALLBACK_RE.test(data)) return null;

  const parts = data.split(':');
  // tm : action : groupId : threadId : userId : hmac
  if (parts.length !== 6) return null;

  const [, action, groupId, threadId, userId, signature] = parts as [
    string, string, string, string, string, string,
  ];

  // Verify context match (prevent cross-topic tampering)
  if (groupId !== contextGroupId || threadId !== contextThreadId) return null;

  // Verify HMAC
  const payload = `tm:${action}:${groupId}:${threadId}:${userId}`;
  if (!hmacVerify(secret, payload, signature)) return null;

  return { action, groupId, threadId, userId };
}
