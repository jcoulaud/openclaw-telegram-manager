import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AuditEntry } from './types.js';

const AUDIT_FILENAME = 'audit.jsonl';
const FILE_MODE = 0o600;

/**
 * Append an audit entry to the audit.jsonl file.
 * Creates the file if it does not exist. Each entry is a single JSON line.
 * File permissions are set to 0600.
 */
export function appendAudit(workspaceDir: string, entry: AuditEntry): void {
  const auditPath = path.join(workspaceDir, 'projects', AUDIT_FILENAME);
  const line = JSON.stringify(entry) + '\n';

  const fd = fs.openSync(auditPath, 'a', FILE_MODE);
  try {
    fs.writeSync(fd, line);
  } finally {
    fs.closeSync(fd);
  }

  // Ensure permissions are correct even if file already existed
  fs.chmodSync(auditPath, FILE_MODE);
}

/**
 * Build an AuditEntry with the current timestamp.
 */
export function buildAuditEntry(
  userId: string,
  cmd: string,
  slug: string,
  detail: string,
): AuditEntry {
  return {
    ts: new Date().toISOString(),
    userId,
    cmd,
    slug,
    detail,
  };
}
