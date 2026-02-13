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

  describe('cron job cleanup on archive', () => {
    it('should call cron.remove when topic has cronJobId', async () => {
      const entry = makeEntry({ cronJobId: 'cron-xyz-789' });
      setupRegistry(entry);

      const rpc = {
        call: vi.fn().mockResolvedValue({}),
      };

      await handleArchive(makeCtx({ rpc }));

      expect(rpc.call).toHaveBeenCalledWith('cron.remove', { jobId: 'cron-xyz-789' });

      const reg = readRegistry(workspaceDir);
      expect(reg.topics['-100:1']?.cronJobId).toBeNull();
      expect(reg.topics['-100:1']?.status).toBe('archived');
    });

    it('should not call cron.remove when topic has no cronJobId', async () => {
      const entry = makeEntry({ cronJobId: null });
      setupRegistry(entry);

      const rpc = {
        call: vi.fn().mockResolvedValue({}),
      };

      await handleArchive(makeCtx({ rpc }));

      // cron.remove should not be called (config.get may still be called)
      expect(rpc.call).not.toHaveBeenCalledWith('cron.remove', expect.anything());

      const reg = readRegistry(workspaceDir);
      expect(reg.topics['-100:1']?.status).toBe('archived');
    });

    it('should still archive when cron removal fails', async () => {
      const entry = makeEntry({ cronJobId: 'cron-fail' });
      setupRegistry(entry);

      const rpc = {
        call: vi.fn().mockRejectedValue(new Error('RPC unavailable')),
      };

      const result = await handleArchive(makeCtx({ rpc }));

      expect(result.text).toContain('archived');
      const reg = readRegistry(workspaceDir);
      expect(reg.topics['-100:1']?.status).toBe('archived');
    });
  });

  describe('cron job re-registration on unarchive', () => {
    it('should register cron job when unarchiving', async () => {
      const entry = makeEntry({ status: 'archived', cronJobId: null });
      setupRegistry(entry);

      const rpc = {
        call: vi.fn().mockResolvedValue({ jobId: 'cron-new-456' }),
      };

      await handleUnarchive(makeCtx({ rpc }));

      expect(rpc.call).toHaveBeenCalledWith(
        'cron.add',
        expect.objectContaining({
          name: 'tm-daily-t-1',
        }),
      );

      const reg = readRegistry(workspaceDir);
      expect(reg.topics['-100:1']?.cronJobId).toBe('cron-new-456');
      expect(reg.topics['-100:1']?.status).toBe('active');
    });

    it('should still unarchive when cron registration fails', async () => {
      const entry = makeEntry({ status: 'archived', cronJobId: null });
      setupRegistry(entry);

      const rpc = {
        call: vi.fn().mockRejectedValue(new Error('RPC timeout')),
      };

      const result = await handleUnarchive(makeCtx({ rpc }));

      expect(result.text).toContain('unarchived');
      const reg = readRegistry(workspaceDir);
      expect(reg.topics['-100:1']?.status).toBe('active');
      expect(reg.topics['-100:1']?.cronJobId).toBeNull();
    });
  });
});
