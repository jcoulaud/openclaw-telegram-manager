import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleDailyReport, computeHealth } from '../../src/commands/daily-report.js';
import {
  createEmptyRegistry,
  writeRegistryAtomic,
  registryPath,
  readRegistry,
} from '../../src/lib/registry.js';
import { scaffoldCapsule } from '../../src/lib/capsule.js';
import type { CommandContext, TopicEntry } from '../../src/lib/types.js';
import { CAPSULE_VERSION } from '../../src/lib/types.js';

describe('daily-report', () => {
  let tmpDir: string;
  let workspaceDir: string;
  let configDir: string;

  const makeCtx = (overrides?: Partial<CommandContext>): CommandContext => ({
    workspaceDir,
    configDir,
    logger: { info() {}, warn() {}, error() {} },
    userId: 'user1',
    groupId: '-100',
    threadId: '1',
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-report-test-'));
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
    registry.topicManagerAdmins = ['user1'];
    registry.topics = entries;
    writeRegistryAtomic(registryPath(workspaceDir), registry);
    return registry;
  }

  describe('context validation', () => {
    it('should reject when groupId is missing', async () => {
      const result = await handleDailyReport(makeCtx({ groupId: undefined }));
      expect(result.text).toContain('Missing context');
    });

    it('should reject when threadId is missing', async () => {
      const result = await handleDailyReport(makeCtx({ threadId: undefined }));
      expect(result.text).toContain('Missing context');
    });

    it('should reject when topic not registered', async () => {
      setupRegistry({});
      const result = await handleDailyReport(makeCtx());
      expect(result.text).toContain('not registered');
    });
  });

  describe('dedup', () => {
    it('should skip if already reported today', async () => {
      const entry = makeEntry({ lastDailyReportAt: new Date().toISOString() });
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });

      const result = await handleDailyReport(makeCtx());
      expect(result.text).toContain('already generated today');
    });

    it('should allow report if last report was yesterday', async () => {
      const yesterday = new Date(Date.now() - 25 * 3_600_000);
      const entry = makeEntry({ lastDailyReportAt: yesterday.toISOString() });
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      const result = await handleDailyReport(makeCtx());
      expect(result.text).toContain('Daily Report');
    });
  });

  describe('report generation', () => {
    it('should produce expected sections', async () => {
      const entry = makeEntry();
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      const result = await handleDailyReport(makeCtx());
      expect(result.text).toContain('Daily Report');
      expect(result.text).toContain('Done today');
      expect(result.text).toContain('New learnings');
      expect(result.text).toContain('Blockers/Risks');
      expect(result.text).toContain('Next actions (now)');
      expect(result.text).toContain('Upcoming');
      expect(result.text).toContain('Health:');
    });

    it('should update lastDailyReportAt on success', async () => {
      const entry = makeEntry();
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      await handleDailyReport(makeCtx());

      const reg = readRegistry(workspaceDir);
      expect(reg.topics[key]?.lastDailyReportAt).not.toBeNull();
    });
  });

  describe('with postFn', () => {
    it('should post report to topic', async () => {
      const entry = makeEntry();
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      const postCalls: { groupId: string; threadId: string }[] = [];
      const postFn = vi.fn(async (gId: string, tId: string) => {
        postCalls.push({ groupId: gId, threadId: tId });
      });

      await handleDailyReport(makeCtx({ postFn }));

      expect(postCalls).toHaveLength(1);
      expect(postCalls[0]?.groupId).toBe('-100');
      expect(postCalls[0]?.threadId).toBe('1');
    });

    it('should handle post failure gracefully', async () => {
      const entry = makeEntry();
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      const postFn = vi.fn(async () => {
        throw new Error('Network error');
      });

      const result = await handleDailyReport(makeCtx({ postFn }));
      expect(result.text).toContain('post failed');
    });
  });

  describe('computeHealth', () => {
    it('should return "fresh" for recent activity and no blockers', () => {
      const recent = new Date().toISOString();
      expect(computeHealth(recent, '## some status', '_None._')).toBe('fresh');
    });

    it('should return "stale" for old activity', () => {
      const old = new Date(Date.now() - 4 * 24 * 3_600_000).toISOString();
      expect(computeHealth(old, '## some status', '_None._')).toBe('stale');
    });

    it('should return "stale" for null lastMessageAt', () => {
      expect(computeHealth(null, '## some status', '_None._')).toBe('stale');
    });

    it('should return "blocked" when blockers exist', () => {
      const recent = new Date().toISOString();
      expect(computeHealth(recent, '## some status', '- [BLOCKED] Something is blocked')).toBe('blocked');
    });
  });
});
