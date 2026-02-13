import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createTopicManagerTool } from '../src/tool.js';
import type { ToolDeps } from '../src/tool.js';
import {
  createEmptyRegistry,
  writeRegistryAtomic,
  registryPath,
  readRegistry,
} from '../src/lib/registry.js';
import { scaffoldCapsule } from '../src/lib/capsule.js';
import type { TopicEntry } from '../src/lib/types.js';

describe('tool activity tracking', () => {
  let tmpDir: string;
  let workspaceDir: string;
  let configDir: string;

  const makeDeps = (overrides?: Partial<ToolDeps>): ToolDeps => ({
    logger: { info() {}, warn() {}, error() {} },
    configDir,
    workspaceDir,
    ...overrides,
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-activity-test-'));
    workspaceDir = path.join(tmpDir, 'workspace');
    configDir = path.join(tmpDir, 'config');
    const projectsDir = path.join(workspaceDir, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupWithTopic(overrides?: Partial<TopicEntry>) {
    const entry: TopicEntry = {
      groupId: '-100',
      threadId: '1',
      slug: 't-1',
      name: 'Test Topic',
      type: 'coding',
      status: 'active',
      capsuleVersion: 2,
      lastMessageAt: null,
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
    };

    const registry = createEmptyRegistry('secret');
    registry.topicManagerAdmins = ['user1'];
    registry.topics[`${entry.groupId}:${entry.threadId}`] = entry;
    writeRegistryAtomic(registryPath(workspaceDir), registry);
    scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);
    return entry;
  }

  // Helper: wait for fire-and-forget withRegistry to settle
  const settle = () => new Promise((r) => setTimeout(r, 200));

  describe('lastMessageAt', () => {
    it('should update on user commands (status)', async () => {
      setupWithTopic();
      const tool = createTopicManagerTool(makeDeps());

      await tool.execute('id', { command: 'status' }, {
        groupId: '-100',
        threadId: '1',
        userId: 'user1',
      });
      await settle();

      const reg = readRegistry(workspaceDir);
      expect(reg.topics['-100:1']?.lastMessageAt).not.toBeNull();
    });

    it('should NOT update on tm: callbacks', async () => {
      setupWithTopic();
      const tool = createTopicManagerTool(makeDeps());

      await tool.execute('id', { command: 'tm:fix:-100:1:user1:fakesig' }, {
        groupId: '-100',
        threadId: '1',
        userId: 'user1',
      });
      await settle();

      const reg = readRegistry(workspaceDir);
      expect(reg.topics['-100:1']?.lastMessageAt).toBeNull();
    });

    it('should NOT update for non-registered topics', async () => {
      setupWithTopic();
      const tool = createTopicManagerTool(makeDeps());

      // Use a different threadId not in registry
      await tool.execute('id', { command: 'status' }, {
        groupId: '-100',
        threadId: '999',
        userId: 'user1',
      });
      await settle();

      const reg = readRegistry(workspaceDir);
      // Original topic should be unchanged
      expect(reg.topics['-100:1']?.lastMessageAt).toBeNull();
    });
  });

  describe('auto-upgrade', () => {
    it('should bump capsuleVersion when behind', async () => {
      setupWithTopic({ capsuleVersion: 1 });
      const tool = createTopicManagerTool(makeDeps());

      await tool.execute('id', { command: 'status' }, {
        groupId: '-100',
        threadId: '1',
        userId: 'user1',
      });
      await settle();

      const reg = readRegistry(workspaceDir);
      expect(reg.topics['-100:1']?.capsuleVersion).toBe(3);
    });

    it('should add LEARNINGS.md when upgrading from v1', async () => {
      setupWithTopic({ capsuleVersion: 1 });

      // Remove LEARNINGS.md to simulate v1 capsule
      const learningsPath = path.join(workspaceDir, 'projects', 't-1', 'LEARNINGS.md');
      if (fs.existsSync(learningsPath)) fs.unlinkSync(learningsPath);

      const tool = createTopicManagerTool(makeDeps());
      await tool.execute('id', { command: 'status' }, {
        groupId: '-100',
        threadId: '1',
        userId: 'user1',
      });
      await settle();

      expect(fs.existsSync(learningsPath)).toBe(true);
    });

    it('should no-op when already at current version', async () => {
      const logSpy = vi.fn();
      setupWithTopic({ capsuleVersion: 3 });
      const tool = createTopicManagerTool(makeDeps({
        logger: { info: logSpy, warn() {}, error() {} },
      }));

      await tool.execute('id', { command: 'status' }, {
        groupId: '-100',
        threadId: '1',
        userId: 'user1',
      });
      await settle();

      // Should not have logged an auto-upgrade
      expect(logSpy.mock.calls.some(([msg]: string[]) =>
        msg.includes('[auto-upgrade]'),
      )).toBe(false);
    });
  });
});
