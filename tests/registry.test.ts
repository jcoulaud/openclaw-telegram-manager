import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  registryPath,
  readRegistry,
  writeRegistryAtomic,
  withRegistry,
  createEmptyRegistry,
} from '../src/lib/registry.js';
import type { Registry, TopicEntry } from '../src/lib/types.js';
import { CURRENT_REGISTRY_VERSION } from '../src/lib/types.js';

describe('registry', () => {
  let tmpDir: string;
  let workspaceDir: string;
  let projectsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'));
    workspaceDir = tmpDir;
    projectsDir = path.join(workspaceDir, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('registryPath', () => {
    it('should return correct path', () => {
      const result = registryPath(workspaceDir);
      expect(result).toBe(path.join(workspaceDir, 'projects', 'topics.json'));
    });
  });

  describe('createEmptyRegistry', () => {
    it('should create valid empty registry', () => {
      const secret = 'test-secret-12345';
      const registry = createEmptyRegistry(secret);

      expect(registry.version).toBe(CURRENT_REGISTRY_VERSION);
      expect(registry.topicManagerAdmins).toEqual([]);
      expect(registry.callbackSecret).toBe(secret);
      expect(registry.lastDoctorAllRunAt).toBeNull();
      expect(registry.autopilotEnabled).toBe(false);
      expect(registry.maxTopics).toBe(100);
      expect(registry.topics).toEqual({});
    });
  });

  describe('writeRegistryAtomic', () => {
    it('should write registry with proper permissions', () => {
      const regPath = registryPath(workspaceDir);
      const registry = createEmptyRegistry('secret');

      writeRegistryAtomic(regPath, registry);

      expect(fs.existsSync(regPath)).toBe(true);
      const stat = fs.statSync(regPath);
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('should write valid JSON', () => {
      const regPath = registryPath(workspaceDir);
      const registry = createEmptyRegistry('secret');

      writeRegistryAtomic(regPath, registry);

      const content = fs.readFileSync(regPath, 'utf-8');
      const parsed = JSON.parse(content) as Registry;
      expect(parsed.version).toBe(CURRENT_REGISTRY_VERSION);
    });

    it('should use atomic write with tmp file', () => {
      const regPath = registryPath(workspaceDir);
      const registry = createEmptyRegistry('secret');

      writeRegistryAtomic(regPath, registry);

      // Tmp file should be cleaned up
      expect(fs.existsSync(regPath + '.tmp')).toBe(false);
    });
  });

  describe('readRegistry', () => {
    it('should read valid registry', () => {
      const regPath = registryPath(workspaceDir);
      const original = createEmptyRegistry('secret');
      writeRegistryAtomic(regPath, original);

      const result = readRegistry(workspaceDir);

      expect(result.version).toBe(CURRENT_REGISTRY_VERSION);
      expect(result.callbackSecret).toBe('secret');
    });

    it('should reject invalid JSON', () => {
      const regPath = registryPath(workspaceDir);
      fs.writeFileSync(regPath, 'not valid json', { mode: 0o600 });

      expect(() => readRegistry(workspaceDir)).toThrow(/invalid JSON/);
    });

    it('should reject missing version field', () => {
      const regPath = registryPath(workspaceDir);
      fs.writeFileSync(regPath, '{"topics": {}}', { mode: 0o600 });

      expect(() => readRegistry(workspaceDir)).toThrow(/missing version/);
    });

    it('should reject future version', () => {
      const regPath = registryPath(workspaceDir);
      const registry = createEmptyRegistry('secret');
      registry.version = 999;
      writeRegistryAtomic(regPath, registry);

      expect(() => readRegistry(workspaceDir)).toThrow(/newer than this plugin supports/);
    });

    it('should quarantine invalid topic entries', () => {
      const regPath = registryPath(workspaceDir);
      const registry = createEmptyRegistry('secret');

      // Add valid entry
      const validEntry: TopicEntry = {
        groupId: '-100123',
        threadId: '456',
        slug: 'test-topic',
        name: 'test-topic',
        type: 'coding',
        status: 'active',
        capsuleVersion: 1,
        lastMessageAt: null,
        lastDoctorReportAt: null,
        lastDoctorRunAt: null,
        lastCapsuleWriteAt: null,
        snoozeUntil: null,
        ignoreChecks: [],
        consecutiveSilentDoctors: 0,
        lastPostError: null,
        extras: {},
      };
      registry.topics['-100123:456'] = validEntry;

      // Add invalid entry (wrong slug format)
      const invalidEntry = { ...validEntry, slug: 'INVALID_SLUG' } as unknown as TopicEntry;
      registry.topics['-100123:789'] = invalidEntry;

      writeRegistryAtomic(regPath, registry);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = readRegistry(workspaceDir);
      consoleSpy.mockRestore();

      // Valid entry should be present
      expect(result.topics['-100123:456']).toBeDefined();
      // Invalid entry should be quarantined
      expect(result.topics['-100123:789']).toBeUndefined();
    });

    it('should migrate v2 registry to v3 by adding autopilotEnabled', () => {
      const regPath = registryPath(workspaceDir);
      const v2Registry = {
        version: 2,
        topicManagerAdmins: ['admin1'],
        callbackSecret: 'secret',
        lastDoctorAllRunAt: null,
        maxTopics: 100,
        topics: {},
      };
      fs.writeFileSync(regPath, JSON.stringify(v2Registry), { mode: 0o600 });

      const result = readRegistry(workspaceDir);

      expect(result.version).toBe(CURRENT_REGISTRY_VERSION);
      expect(result.autopilotEnabled).toBe(false);
    });

    it('should migrate v3 registry to v4 by adding lastCapsuleWriteAt', () => {
      const regPath = registryPath(workspaceDir);
      const v3Registry = {
        version: 3,
        topicManagerAdmins: [],
        callbackSecret: 'secret',
        lastDoctorAllRunAt: null,
        autopilotEnabled: false,
        maxTopics: 100,
        topics: {
          '-100:1': {
            groupId: '-100',
            threadId: '1',
            slug: 'alpha',
            name: 'alpha',
            type: 'coding',
            status: 'active',
            capsuleVersion: 2,
            lastMessageAt: null,
            lastDoctorReportAt: null,
            lastDoctorRunAt: null,
            snoozeUntil: null,
            ignoreChecks: [],
            consecutiveSilentDoctors: 0,
            lastPostError: null,
            extras: {},
          },
        },
      };
      fs.writeFileSync(regPath, JSON.stringify(v3Registry), { mode: 0o600 });

      const result = readRegistry(workspaceDir);

      expect(result.version).toBe(CURRENT_REGISTRY_VERSION);
      expect(result.topics['-100:1']?.lastCapsuleWriteAt).toBeNull();
    });

    it('should migrate v1 registry entries by setting name = slug', () => {
      const regPath = registryPath(workspaceDir);
      // Write a v1-shaped registry (entries have no `name` field)
      const v1Registry = {
        version: 1,
        topicManagerAdmins: [],
        callbackSecret: 'secret',
        lastDoctorAllRunAt: null,
        maxTopics: 100,
        topics: {
          '-100:1': {
            groupId: '-100',
            threadId: '1',
            slug: 'alpha',
            type: 'coding',
            status: 'active',
            capsuleVersion: 1,
            lastMessageAt: null,
            lastDoctorReportAt: null,
            lastDoctorRunAt: null,
            snoozeUntil: null,
            ignoreChecks: [],
            consecutiveSilentDoctors: 0,
            lastPostError: null,
            extras: {},
          },
          '-100:2': {
            groupId: '-100',
            threadId: '2',
            slug: 'beta',
            type: 'research',
            status: 'snoozed',
            capsuleVersion: 1,
            lastMessageAt: null,
            lastDoctorReportAt: null,
            lastDoctorRunAt: null,
            snoozeUntil: null,
            ignoreChecks: [],
            consecutiveSilentDoctors: 0,
            lastPostError: null,
            extras: {},
          },
        },
      };
      fs.writeFileSync(regPath, JSON.stringify(v1Registry), { mode: 0o600 });

      const result = readRegistry(workspaceDir);

      expect(result.version).toBe(CURRENT_REGISTRY_VERSION);
      expect(result.topics['-100:1']?.name).toBe('alpha');
      expect(result.topics['-100:2']?.name).toBe('beta');
    });
  });

  describe('withRegistry', () => {
    it('should lock, read, mutate, and write registry', async () => {
      const regPath = registryPath(workspaceDir);
      const registry = createEmptyRegistry('secret');
      writeRegistryAtomic(regPath, registry);

      const result = await withRegistry(workspaceDir, (data) => {
        data.maxTopics = 50;
        return 'modified';
      });

      expect(result).toBe('modified');

      const updated = readRegistry(workspaceDir);
      expect(updated.maxTopics).toBe(50);
    });

    it('should handle async mutation function', async () => {
      const regPath = registryPath(workspaceDir);
      const registry = createEmptyRegistry('secret');
      writeRegistryAtomic(regPath, registry);

      await withRegistry(workspaceDir, async (data) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        data.maxTopics = 75;
      });

      const updated = readRegistry(workspaceDir);
      expect(updated.maxTopics).toBe(75);
    });

    it('should throw if registry does not exist', async () => {
      await expect(withRegistry(workspaceDir, () => {})).rejects.toThrow(/Registry not found/);
    });

    it('should release lock even on error', async () => {
      const regPath = registryPath(workspaceDir);
      const registry = createEmptyRegistry('secret');
      writeRegistryAtomic(regPath, registry);

      await expect(
        withRegistry(workspaceDir, () => {
          throw new Error('test error');
        })
      ).rejects.toThrow('test error');

      // Should be able to acquire lock again
      await withRegistry(workspaceDir, (data) => {
        data.maxTopics = 25;
      });

      const updated = readRegistry(workspaceDir);
      expect(updated.maxTopics).toBe(25);
    });
  });

  describe('schema validation', () => {
    it('should validate topic entry schema', () => {
      const regPath = registryPath(workspaceDir);
      const registry = createEmptyRegistry('secret');

      const entry: TopicEntry = {
        groupId: '-100123',
        threadId: '456',
        slug: 'valid-slug',
        name: 'valid-slug',
        type: 'research',
        status: 'snoozed',
        capsuleVersion: 1,
        lastMessageAt: '2025-01-01T00:00:00Z',
        lastDoctorReportAt: null,
        lastDoctorRunAt: null,
        lastCapsuleWriteAt: null,
        snoozeUntil: '2025-12-31T23:59:59Z',
        ignoreChecks: ['check1', 'check2'],
        consecutiveSilentDoctors: 2,
        lastPostError: 'some error',
        extras: { key: 'value' },
      };

      registry.topics['-100123:456'] = entry;
      writeRegistryAtomic(regPath, registry);

      const result = readRegistry(workspaceDir);
      expect(result.topics['-100123:456']).toEqual(entry);
    });
  });
});
