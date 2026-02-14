import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  handleDailyReportAll,
  getDailyReportEligibility,
  buildDailyReportAllSummary,
} from '../../src/commands/daily-report-all.js';
import type { DailyReportAllSummaryData } from '../../src/commands/daily-report-all.js';
import {
  createEmptyRegistry,
  writeRegistryAtomic,
  registryPath,
  readRegistry,
} from '../../src/lib/registry.js';
import { scaffoldCapsule } from '../../src/lib/capsule.js';
import type { CommandContext, TopicEntry } from '../../src/lib/types.js';
import { CAPSULE_VERSION } from '../../src/lib/types.js';

describe('daily-report-all', () => {
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
    cronJobId: null,
    extras: {},
    ...overrides,
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-report-all-test-'));
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

  describe('getDailyReportEligibility', () => {
    const now = new Date('2025-06-15T12:00:00Z');
    const eightDaysAgo = new Date('2025-06-07T12:00:00Z').toISOString();
    const twoDaysAgo = new Date('2025-06-13T12:00:00Z').toISOString();

    it('should return archived skip reason for archived topics', () => {
      const entry = makeEntry({ status: 'archived', lastMessageAt: twoDaysAgo });
      const result = getDailyReportEligibility(entry, now);
      expect(result.eligible).toBe(false);
      expect(result.skipReason).toBe('archived');
    });

    it('should return snoozed skip reason for snoozed topics', () => {
      const entry = makeEntry({
        status: 'snoozed',
        lastMessageAt: twoDaysAgo,
        snoozeUntil: new Date('2025-07-01T00:00:00Z').toISOString(),
      });
      const result = getDailyReportEligibility(entry, now);
      expect(result.eligible).toBe(false);
      expect(result.skipReason).toBe('snoozed');
    });

    it('should return inactive skip reason for stale topics', () => {
      const entry = makeEntry({ lastMessageAt: eightDaysAgo });
      const result = getDailyReportEligibility(entry, now, null);
      expect(result.eligible).toBe(false);
      expect(result.skipReason).toBe('inactive');
    });

    it('should return already-reported-today for same UTC day', () => {
      const entry = makeEntry({
        lastMessageAt: twoDaysAgo,
        lastDailyReportAt: new Date('2025-06-15T05:00:00Z').toISOString(),
      });
      const result = getDailyReportEligibility(entry, now);
      expect(result.eligible).toBe(false);
      expect(result.skipReason).toBe('already-reported-today');
    });

    it('should be eligible when reported yesterday', () => {
      const entry = makeEntry({
        lastMessageAt: twoDaysAgo,
        lastDailyReportAt: new Date('2025-06-14T23:59:00Z').toISOString(),
      });
      const result = getDailyReportEligibility(entry, now);
      expect(result.eligible).toBe(true);
      expect(result.skipReason).toBeUndefined();
    });

    it('should return eligible for active topics with no prior report', () => {
      const entry = makeEntry({ lastMessageAt: twoDaysAgo });
      const result = getDailyReportEligibility(entry, now);
      expect(result.eligible).toBe(true);
      expect(result.skipReason).toBeUndefined();
    });

    it('should use STATUS.md timestamp for activity check', () => {
      const entry = makeEntry({ lastMessageAt: eightDaysAgo });
      const result = getDailyReportEligibility(entry, now, twoDaysAgo);
      expect(result.eligible).toBe(true);
    });
  });

  describe('no topics', () => {
    it('should return empty summary when no topics registered', async () => {
      setupRegistry({});

      const result = await handleDailyReportAll(makeCtx());
      expect(result.text).toContain('No topics registered yet.');
    });
  });

  describe('without postFn', () => {
    it('should return summary and update lastDailyReportAt without posting', async () => {
      const entry = makeEntry();
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      const result = await handleDailyReportAll(makeCtx());

      expect(result.text).toContain('Daily Report Summary');
      expect(result.text).toContain('Test Topic');
      expect(result.text).toContain('reported');

      const reg = readRegistry(workspaceDir);
      expect(reg.topics[key]?.lastDailyReportAt).not.toBeNull();
    });
  });

  describe('with postFn', () => {
    it('should post daily report to correct groupId/threadId', async () => {
      const entry = makeEntry();
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      const postCalls: { groupId: string; threadId: string }[] = [];
      const postFn = vi.fn(async (gId: string, tId: string) => {
        postCalls.push({ groupId: gId, threadId: tId });
      });

      const result = await handleDailyReportAll(makeCtx({ postFn }));

      expect(postCalls).toHaveLength(1);
      expect(postCalls[0]?.groupId).toBe('-100');
      expect(postCalls[0]?.threadId).toBe('1');
      expect(result.text).toContain('Test Topic');
      expect(result.text).toContain('reported');
    });

    it('should update lastDailyReportAt on successful post', async () => {
      const entry = makeEntry();
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      const postFn = vi.fn(async () => {});
      await handleDailyReportAll(makeCtx({ postFn }));

      const reg = readRegistry(workspaceDir);
      expect(reg.topics[key]?.lastDailyReportAt).not.toBeNull();
      expect(reg.topics[key]?.lastPostError).toBeNull();
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

      const result = await handleDailyReportAll(makeCtx({ postFn }));

      expect(result.text).toContain('failed to post');

      const reg = readRegistry(workspaceDir);
      const failedEntry = Object.values(reg.topics).find(
        (e) => e.lastPostError !== null,
      );
      expect(failedEntry).toBeDefined();
      expect(failedEntry?.lastPostError).toContain('Network error');

      const successEntry = Object.values(reg.topics).find(
        (e) => e.lastPostError === null && e.lastDailyReportAt !== null,
      );
      expect(successEntry).toBeDefined();
    });
  });

  describe('skipping', () => {
    it('should skip archived topics', async () => {
      const entry = makeEntry({ status: 'archived' });
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      const result = await handleDailyReportAll(makeCtx());

      expect(result.text).toContain('archived');
      expect(result.text).not.toContain('reported');
    });

    it('should skip topics already reported today', async () => {
      const entry = makeEntry({ lastDailyReportAt: new Date().toISOString() });
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      const result = await handleDailyReportAll(makeCtx());

      expect(result.text).toContain('already reported today');
    });

    it('should skip inactive topics', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const entry = makeEntry({ lastMessageAt: eightDaysAgo });
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });

      // Manually create capsule with a stale STATUS.md (not scaffoldCapsule,
      // which writes a fresh timestamp that would make the topic look active)
      const capsuleDir = path.join(workspaceDir, 'projects', entry.slug);
      fs.mkdirSync(capsuleDir, { recursive: true });
      fs.writeFileSync(path.join(capsuleDir, 'STATUS.md'), `# Status: Test\n\n## Last done (UTC)\n\n${eightDaysAgo}\n\n## Next actions (now)\n\n_None._`);

      const result = await handleDailyReportAll(makeCtx());

      expect(result.text).toContain('inactive');
    });
  });

  describe('auth', () => {
    it('should reject non-admin users', async () => {
      setupRegistry({});
      const result = await handleDailyReportAll(makeCtx({ userId: 'non-admin' }));
      expect(result.text).toContain('Not authorized');
    });

    it('should fall back to first admin when userId is absent (autopilot)', async () => {
      const entry = makeEntry();
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      const result = await handleDailyReportAll(makeCtx({ userId: undefined }));
      expect(result.text).toContain('Daily Report Summary');
    });
  });

  describe('buildDailyReportAllSummary', () => {
    const baseSummary: DailyReportAllSummaryData = {
      reportedTopics: [],
      skippedTopics: [],
      postFailures: 0,
      migrationGroups: 0,
      errors: [],
    };

    it('should show empty workspace message when no topics', () => {
      const result = buildDailyReportAllSummary(baseSummary);
      expect(result).toContain('No topics registered yet.');
    });

    it('should show all reported with no skipped section', () => {
      const result = buildDailyReportAllSummary({
        ...baseSummary,
        reportedTopics: [
          { name: 'Alpha', slug: 'alpha', status: 'reported' },
          { name: 'Beta', slug: 'beta', status: 'reported' },
        ],
      });
      expect(result).toContain('✅ Alpha — reported');
      expect(result).toContain('✅ Beta — reported');
      expect(result).not.toContain('Skipped');
    });

    it('should show both reported and skipped sections', () => {
      const result = buildDailyReportAllSummary({
        ...baseSummary,
        reportedTopics: [{ name: 'Alpha', slug: 'alpha', status: 'reported' }],
        skippedTopics: [
          { name: 'Gamma', reason: 'snoozed' },
          { name: 'Delta', reason: 'inactive' },
        ],
      });
      expect(result).toContain('✅ Alpha — reported');
      expect(result).toContain('Skipped');
      expect(result).toContain('💤 Gamma — snoozed');
      expect(result).toContain('🔇 Delta — inactive');
    });

    it('should show per-topic skip reasons', () => {
      const result = buildDailyReportAllSummary({
        ...baseSummary,
        skippedTopics: [
          { name: 'Archived Project', reason: 'archived' },
          { name: 'Snoozed Project', reason: 'snoozed' },
          { name: 'Quiet Project', reason: 'inactive' },
          { name: 'Recent Project', reason: 'already-reported-today' },
        ],
      });
      expect(result).toContain('📦 Archived Project — archived');
      expect(result).toContain('💤 Snoozed Project — snoozed');
      expect(result).toContain('🔇 Quiet Project — inactive');
      expect(result).toContain('⏰ Recent Project — already reported today');
    });

    it('should show post-failed topics with warning icon', () => {
      const result = buildDailyReportAllSummary({
        ...baseSummary,
        reportedTopics: [{ name: 'Failed Topic', slug: 'failed', status: 'post-failed' }],
        postFailures: 1,
      });
      expect(result).toContain('⚠️ Failed Topic — failed to post');
      expect(result).toContain('1 topic(s) failed to post');
    });

    it('should suppress zero-value post failures', () => {
      const result = buildDailyReportAllSummary({
        ...baseSummary,
        reportedTopics: [{ name: 'Alpha', slug: 'alpha', status: 'reported' }],
        postFailures: 0,
      });
      expect(result).not.toContain('failed to post');
    });

    it('should show migration warning when all topics in a group fail', () => {
      const result = buildDailyReportAllSummary({
        ...baseSummary,
        reportedTopics: [{ name: 'Alpha', slug: 'alpha', status: 'post-failed' }],
        migrationGroups: 1,
      });
      expect(result).toContain('1 group(s) had all topics fail');
    });
  });
});
