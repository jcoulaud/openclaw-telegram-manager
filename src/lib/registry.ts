import * as fs from 'node:fs';
import * as path from 'node:path';
import lockfile from 'proper-lockfile';
import { Value } from '@sinclair/typebox/value';
import {
  RegistrySchema,
  TopicEntrySchema,
  CURRENT_REGISTRY_VERSION,
  MAX_TOPICS_DEFAULT,
} from './types.js';
import type { Registry, TopicEntry } from './types.js';

// ── Constants ──────────────────────────────────────────────────────────

const REGISTRY_FILENAME = 'topics.json';
const FILE_MODE = 0o600;
const LOCK_TIMEOUT = 5000;
const LOCK_RETRY_INTERVAL = 100;

// ── Path helpers ───────────────────────────────────────────────────────

export function registryPath(workspaceDir: string): string {
  return path.join(workspaceDir, 'projects', REGISTRY_FILENAME);
}

// ── Schema migration pipeline ──────────────────────────────────────────

type MigrationFn = (data: Record<string, unknown>) => Record<string, unknown>;

const migrations: Record<string, MigrationFn> = {
  '1_to_2': (data) => {
    const topics = data['topics'];
    if (topics && typeof topics === 'object' && !Array.isArray(topics)) {
      for (const entry of Object.values(topics as Record<string, Record<string, unknown>>)) {
        if (!entry['name'] && typeof entry['slug'] === 'string') {
          entry['name'] = entry['slug'];
        }
      }
    }
    return data;
  },
};

function migrateRegistry(data: Record<string, unknown>): Record<string, unknown> {
  const rawVersion = data['version'];
  if (typeof rawVersion !== 'number') {
    throw new Error('Registry missing or invalid version field in migration');
  }
  let version = rawVersion;

  while (version < CURRENT_REGISTRY_VERSION) {
    const key = `${version}_to_${version + 1}`;
    const fn = migrations[key];
    if (!fn) {
      throw new Error(
        `No migration function found for ${key}. Cannot upgrade registry from v${version}.`,
      );
    }
    data = fn(data);
    version++;
    data['version'] = version;
  }

  return data;
}

// ── Read ───────────────────────────────────────────────────────────────

/**
 * Read and validate the registry from disk.
 * - Migrates if version is behind current
 * - Rejects if version is ahead of current
 * - Quarantines invalid topic entries (logs + excludes)
 */
export function readRegistry(workspaceDir: string): Registry {
  const regPath = registryPath(workspaceDir);
  const raw = fs.readFileSync(regPath, 'utf-8');
  let data: Record<string, unknown>;

  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Failed to parse registry at ${regPath}: invalid JSON`);
  }

  // Version check
  const version = data['version'];
  if (typeof version !== 'number') {
    throw new Error('Registry missing version field');
  }

  if (version > CURRENT_REGISTRY_VERSION) {
    throw new Error(
      `Registry version ${version} is newer than this plugin supports (v${CURRENT_REGISTRY_VERSION}). Please upgrade openclaw-telegram-manager.`,
    );
  }

  // Migrate if needed
  if (version < CURRENT_REGISTRY_VERSION) {
    data = migrateRegistry(data);
  }

  // Quarantine invalid topic entries
  const topics = data['topics'];
  if (topics && typeof topics === 'object' && !Array.isArray(topics)) {
    const validTopics: Record<string, TopicEntry> = {};
    for (const [key, entry] of Object.entries(topics as Record<string, unknown>)) {
      if (Value.Check(TopicEntrySchema, entry)) {
        validTopics[key] = entry as TopicEntry;
      } else {
        const errors = [...Value.Errors(TopicEntrySchema, entry)];
        const errorMsg = errors.map((e) => `${e.path}: ${e.message}`).join('; ');
        console.error(`[registry] Quarantined invalid entry "${key}": ${errorMsg}`);
      }
    }
    data['topics'] = validTopics;
  }

  // Validate the full registry schema
  if (!Value.Check(RegistrySchema, data)) {
    const errors = [...Value.Errors(RegistrySchema, data)];
    const errorMsg = errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`Registry validation failed: ${errorMsg}`);
  }

  return data as Registry;
}

// ── Atomic write ───────────────────────────────────────────────────────

/**
 * Atomically write registry data to disk.
 * Writes to a .tmp file then renames (atomic on POSIX).
 */
export function writeRegistryAtomic(filePath: string, data: Registry): void {
  const tmpPath = filePath + '.tmp';
  const content = JSON.stringify(data, null, 2) + '\n';

  fs.writeFileSync(tmpPath, content, { mode: FILE_MODE });
  fs.renameSync(tmpPath, filePath);
  fs.chmodSync(filePath, FILE_MODE);
}

// ── withRegistry pattern ───────────────────────────────────────────────

/**
 * Lock the registry, read it, apply a mutation function, and write it back.
 * The lock prevents concurrent writes from corrupting the registry.
 *
 * The mutation function receives the registry data and can modify it.
 * Return value of the mutation function is passed through as the return value.
 */
export async function withRegistry<T>(
  workspaceDir: string,
  fn: (data: Registry) => T | Promise<T>,
): Promise<T> {
  const regPath = registryPath(workspaceDir);
  const lockDir = path.dirname(regPath);

  // Ensure the registry file exists before locking
  if (!fs.existsSync(regPath)) {
    throw new Error(`Registry not found at ${regPath}. Run setup first.`);
  }

  let release: (() => Promise<void>) | undefined;

  try {
    release = await lockfile.lock(regPath, {
      stale: LOCK_TIMEOUT * 2,
      retries: {
        retries: Math.ceil(LOCK_TIMEOUT / LOCK_RETRY_INTERVAL),
        minTimeout: LOCK_RETRY_INTERVAL,
        maxTimeout: LOCK_RETRY_INTERVAL,
      },
      lockfilePath: path.join(lockDir, REGISTRY_FILENAME + '.lock'),
    });

    const data = readRegistry(workspaceDir);
    const result = await fn(data);

    // Write the (potentially mutated) registry back
    writeRegistryAtomic(regPath, data);

    return result;
  } finally {
    if (release) {
      await release();
    }
  }
}

// ── Empty registry factory ─────────────────────────────────────────────

/**
 * Create a new empty registry with default values.
 */
export function createEmptyRegistry(callbackSecret: string): Registry {
  return {
    version: CURRENT_REGISTRY_VERSION,
    topicManagerAdmins: [],
    callbackSecret,
    lastDoctorAllRunAt: null,
    maxTopics: MAX_TOPICS_DEFAULT,
    topics: {},
  };
}
