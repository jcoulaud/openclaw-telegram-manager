import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleDoctorAll } from '../../src/commands/doctor-all.js';
import {
  createEmptyRegistry,
  writeRegistryAtomic,
  registryPath,
  readRegistry,
} from '../../src/lib/registry.js';
import { scaffoldCapsule } from '../../src/lib/capsule.js';
import type { CommandContext, TopicEntry } from '../../src/lib/types.js';
import { CAPSULE_VERSION } from '../../src/lib/types.js';

describe('doctor-all', () => {
  let tmpDir: string;
  let workspaceDir: string;
  let configDir: string;

  const makeCtx = (overrides?: Partial<CommandContext>): CommandContext => ({
    workspaceDir,
    configDir,
    logger: { info() {}, warn() {}, error() {} },
    userId: 'admin1',
    ...overrides,
  });

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
    extras: {},
    ...overrides,
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-all-test-'));
    workspaceDir = path.join(tmpDir, 'workspace');
    configDir = path.join(tmpDir, 'config');
    const projectsDir = path.join(workspaceDir, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupRegistry(entries: Record<string, TopicEntry>) {
    const registry = createEmptyRegistry('secret');
    registry.topicManagerAdmins = ['admin1'];
    registry.topics = entries;
    writeRegistryAtomic(registryPath(workspaceDir), registry);
    return registry;
  }

  describe('lastDoctorReportAt', () => {
    it('should NOT update lastDoctorReportAt when postFn is undefined (no fan-out)', async () => {
      const entry = makeEntry();
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      await handleDoctorAll(makeCtx());

      const reg = readRegistry(workspaceDir);
      // Without postFn, lastDoctorReportAt is not set (only lastDoctorRunAt is)
      expect(reg.topics[key]?.lastDoctorReportAt).toBeNull();
      expect(reg.topics[key]?.lastDoctorRunAt).not.toBeNull();
    });
  });

  describe('with postFn', () => {
    it('should post each report to correct groupId/threadId', async () => {
      const entry = makeEntry();
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      const postCalls: { groupId: string; threadId: string }[] = [];
      const postFn = vi.fn(async (gId: string, tId: string) => {
        postCalls.push({ groupId: gId, threadId: tId });
      });

      const result = await handleDoctorAll(makeCtx({ postFn }));

      expect(postCalls).toHaveLength(1);
      expect(postCalls[0]?.groupId).toBe('-100');
      expect(postCalls[0]?.threadId).toBe('1');
      expect(result.text).toContain('Posted: 1');
    });

    it('should update lastDoctorReportAt on successful post', async () => {
      const entry = makeEntry();
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      const postFn = vi.fn(async () => {});
      await handleDoctorAll(makeCtx({ postFn }));

      const reg = readRegistry(workspaceDir);
      expect(reg.topics[key]?.lastDoctorReportAt).not.toBeNull();
    });
  });

  describe('without postFn', () => {
    it('should return summary without posting', async () => {
      const entry = makeEntry();
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      const result = await handleDoctorAll(makeCtx());

      expect(result.text).toContain('Health Check Summary');
      expect(result.text).toContain('Checked: 1');
      expect(result.text).not.toContain('Posted:');
    });
  });

  describe('postFn failure', () => {
    it('should set lastPostError and continue with other topics', async () => {
      const entry1 = makeEntry({ threadId: '1', slug: 't-1' });
      const entry2 = makeEntry({ threadId: '2', slug: 't-2' });
      const key1 = `${entry1.groupId}:${entry1.threadId}`;
      const key2 = `${entry2.groupId}:${entry2.threadId}`;
      setupRegistry({ [key1]: entry1, [key2]: entry2 });

      const projectsBase = path.join(workspaceDir, 'projects');
      scaffoldCapsule(projectsBase, entry1.slug, entry1.name, entry1.type);
      scaffoldCapsule(projectsBase, entry2.slug, entry2.name, entry2.type);

      let callCount = 0;
      const postFn = vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Network error');
      });

      const result = await handleDoctorAll(makeCtx({ postFn }));

      expect(result.text).toContain('Post failures: 1');

      const reg = readRegistry(workspaceDir);
      // First topic should have the error
      const failedEntry = Object.values(reg.topics).find(
        (e) => e.lastPostError !== null,
      );
      expect(failedEntry).toBeDefined();
      expect(failedEntry?.lastPostError).toContain('Network error');

      // Second topic should have succeeded
      const successEntry = Object.values(reg.topics).find(
        (e) => e.lastPostError === null && e.lastDoctorReportAt !== null,
      );
      expect(successEntry).toBeDefined();
    });
  });
});
