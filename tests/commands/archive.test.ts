import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleArchive, handleUnarchive } from '../../src/commands/archive.js';
import {
  createEmptyRegistry,
  writeRegistryAtomic,
  registryPath,
  readRegistry,
} from '../../src/lib/registry.js';
import { scaffoldCapsule } from '../../src/lib/capsule.js';
import type { TopicEntry } from '../../src/lib/types.js';
import { CAPSULE_VERSION } from '../../src/lib/types.js';
import type { CommandContext } from '../../src/commands/help.js';

describe('commands/archive', () => {
  let tmpDir: string;
  let workspaceDir: string;
  let configDir: string;

  const makeEntry = (overrides?: Partial<TopicEntry>): TopicEntry => ({
    groupId: '-100',
    threadId: '1',
    slug: 't-1',
    name: 'Test Topic',
    type: 'coding',
    status: 'active',
    capsuleVersion: CAPSULE_VERSION,
    lastMessageAt: new Date().toISOString(),
    lastDoctorReportAt: null,
    lastDoctorRunAt: null,
    lastDailyReportAt: null,
    lastCapsuleWriteAt: null,
    snoozeUntil: null,
    consecutiveSilentDoctors: 0,
    lastPostError: null,
    cronJobId: null,
    extras: {},
    ...overrides,
  });

  const makeCtx = (overrides?: Partial<CommandContext>): CommandContext => ({
    workspaceDir,
    configDir,
    userId: 'admin1',
    groupId: '-100',
    threadId: '1',
    rpc: null,
    logger: { info() {}, warn() {}, error() {} },
    ...overrides,
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-test-'));
    workspaceDir = path.join(tmpDir, 'workspace');
    configDir = path.join(tmpDir, 'config');
    const projectsDir = path.join(workspaceDir, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function setupRegistry(entry: TopicEntry) {
    const registry = createEmptyRegistry('secret');
    registry.topicManagerAdmins = ['admin1'];
    const key = `${entry.groupId}:${entry.threadId}`;
    registry.topics[key] = entry;
    writeRegistryAtomic(registryPath(workspaceDir), registry);
    scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);
    return registry;
  }

  describe('archive', () => {
    it('should set status to archived', async () => {
      const entry = makeEntry();
      setupRegistry(entry);

      const result = await handleArchive(makeCtx());

      expect(result.text).toContain('archived');
      const reg = readRegistry(workspaceDir);
      expect(reg.topics['-100:1']?.status).toBe('archived');
    });

    it('should return already archived when topic is already archived', async () => {
      const entry = makeEntry({ status: 'archived' });
      setupRegistry(entry);

      const result = await handleArchive(makeCtx());
      expect(result.text).toContain('already archived');
    });
  });

  describe('unarchive', () => {
    it('should set status to active and clear snooze', async () => {
      const entry = makeEntry({
        status: 'archived',
        snoozeUntil: new Date('2099-01-01').toISOString(),
      });
      setupRegistry(entry);

      const result = await handleUnarchive(makeCtx());

      expect(result.text).toContain('unarchived');
      const reg = readRegistry(workspaceDir);
      expect(reg.topics['-100:1']?.status).toBe('active');
      expect(reg.topics['-100:1']?.snoozeUntil).toBeNull();
    });

    it('should return not archived when topic is not archived', async () => {
      const entry = makeEntry({ status: 'active' });
      setupRegistry(entry);

      const result = await handleUnarchive(makeCtx());
      expect(result.text).toContain('not archived');
    });
  });
});
