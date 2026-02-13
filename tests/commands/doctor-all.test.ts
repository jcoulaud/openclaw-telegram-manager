import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleDoctorAll, isEligible, extractStatusTimestamp, getEligibility, buildDoctorAllSummary } from '../../src/commands/doctor-all.js';
import type { DoctorAllSummaryData } from '../../src/commands/doctor-all.js';
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
    cronJobId: null,
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
    it('should post health check to correct groupId/threadId', async () => {
      const entry = makeEntry();
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      const postCalls: { groupId: string; threadId: string }[] = [];
      const postFn = vi.fn(async (gId: string, tId: string) => {
        postCalls.push({ groupId: gId, threadId: tId });
      });

      const result = await handleDoctorAll(makeCtx({ postFn }));

      // 1 post: health check only (daily reports handled by cron)
      expect(postCalls).toHaveLength(1);
      expect(postCalls[0]?.groupId).toBe('-100');
      expect(postCalls[0]?.threadId).toBe('1');
      expect(result.text).toContain('Test Topic');
      expect(result.text).toContain('checked');
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
      expect(result.text).toContain('Test Topic');
      expect(result.text).toContain('checked');
      expect(result.text).not.toContain('failed to post');
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

      let healthCheckCallCount = 0;
      const postFn = vi.fn(async () => {
        // Only fail the first health check post (call 1 of 2 health checks)
        healthCheckCallCount++;
        if (healthCheckCallCount === 1) throw new Error('Network error');
      });

      const result = await handleDoctorAll(makeCtx({ postFn }));

      expect(result.text).toContain('failed to post');

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


  describe('isEligible with STATUS.md timestamp', () => {
    const now = new Date('2025-06-15T12:00:00Z');
    const eightDaysAgo = new Date('2025-06-07T12:00:00Z').toISOString();
    const twoDaysAgo = new Date('2025-06-13T12:00:00Z').toISOString();

    it('should be eligible when lastMessageAt is stale but STATUS.md timestamp is fresh', () => {
      const entry = makeEntry({ lastMessageAt: eightDaysAgo });
      expect(isEligible(entry, now, twoDaysAgo)).toBe(true);
    });

    it('should be ineligible when lastMessageAt is stale and no STATUS.md timestamp', () => {
      const entry = makeEntry({ lastMessageAt: eightDaysAgo });
      expect(isEligible(entry, now, null)).toBe(false);
    });

    it('should be ineligible when both lastMessageAt and STATUS.md timestamp are stale', () => {
      const entry = makeEntry({ lastMessageAt: eightDaysAgo });
      expect(isEligible(entry, now, eightDaysAgo)).toBe(false);
    });

    it('should still skip archived topics regardless of STATUS.md timestamp', () => {
      const entry = makeEntry({ status: 'archived', lastMessageAt: twoDaysAgo });
      expect(isEligible(entry, now, twoDaysAgo)).toBe(false);
    });

    it('should still skip snoozed topics regardless of STATUS.md timestamp', () => {
      const entry = makeEntry({
        status: 'snoozed',
        lastMessageAt: twoDaysAgo,
        snoozeUntil: new Date('2025-07-01T00:00:00Z').toISOString(),
      });
      expect(isEligible(entry, now, twoDaysAgo)).toBe(false);
    });
  });

  describe('extractStatusTimestamp', () => {
    it('should extract ISO timestamp from STATUS.md content', () => {
      const content = '# Status: Test\n\n## Last done (UTC)\n\n2025-06-13T10:30:00Z\n\nDid something.\n\n## Next actions (now)\n\n_None._';
      expect(extractStatusTimestamp(content)).toBe('2025-06-13T10:30');
    });

    it('should return null when no Last done section exists', () => {
      expect(extractStatusTimestamp('# Status: Test\n\nNo sections here')).toBeNull();
    });

    it('should return null when Last done section has no timestamp', () => {
      const content = '# Status: Test\n\n## Last done (UTC)\n\nNo timestamp here.\n\n## Next actions (now)\n';
      expect(extractStatusTimestamp(content)).toBeNull();
    });
  });

  describe('integration: STATUS.md-aware eligibility in doctor-all', () => {
    it('should process topic with stale lastMessageAt but fresh STATUS.md', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const entry = makeEntry({ lastMessageAt: eightDaysAgo });
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      // Write a fresh STATUS.md timestamp
      const statusPath = path.join(workspaceDir, 'projects', entry.slug, 'STATUS.md');
      const freshTs = new Date().toISOString();
      fs.writeFileSync(statusPath, `# Status: Test\n\n## Last done (UTC)\n\n${freshTs}\n\nDid something.\n\n## Next actions (now)\n\n_None._`);

      const result = await handleDoctorAll(makeCtx());
      expect(result.text).toContain('Test Topic');
      expect(result.text).toContain('checked');
      expect(result.text).not.toContain('Skipped');
    });

    it('should skip topic with stale lastMessageAt and no fresh STATUS.md', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const entry = makeEntry({ lastMessageAt: eightDaysAgo });
      const key = `${entry.groupId}:${entry.threadId}`;
      setupRegistry({ [key]: entry });
      scaffoldCapsule(path.join(workspaceDir, 'projects'), entry.slug, entry.name, entry.type);

      // Write a stale STATUS.md timestamp
      const statusPath = path.join(workspaceDir, 'projects', entry.slug, 'STATUS.md');
      fs.writeFileSync(statusPath, `# Status: Test\n\n## Last done (UTC)\n\n${eightDaysAgo}\n\nDid something.\n\n## Next actions (now)\n\n_None._`);

      const result = await handleDoctorAll(makeCtx());
      expect(result.text).not.toContain('✅');
      expect(result.text).toContain('Test Topic');
      expect(result.text).toContain('inactive');
    });
  });

  describe('getEligibility', () => {
    const now = new Date('2025-06-15T12:00:00Z');
    const eightDaysAgo = new Date('2025-06-07T12:00:00Z').toISOString();
    const twoDaysAgo = new Date('2025-06-13T12:00:00Z').toISOString();

    it('should return archived skip reason for archived topics', () => {
      const entry = makeEntry({ status: 'archived', lastMessageAt: twoDaysAgo });
      const result = getEligibility(entry, now);
      expect(result.eligible).toBe(false);
      expect(result.skipReason).toBe('archived');
    });

    it('should return snoozed skip reason for snoozed topics', () => {
      const entry = makeEntry({
        status: 'snoozed',
        lastMessageAt: twoDaysAgo,
        snoozeUntil: new Date('2025-07-01T00:00:00Z').toISOString(),
      });
      const result = getEligibility(entry, now);
      expect(result.eligible).toBe(false);
      expect(result.skipReason).toBe('snoozed');
    });

    it('should return inactive skip reason for stale topics', () => {
      const entry = makeEntry({ lastMessageAt: eightDaysAgo });
      const result = getEligibility(entry, now, null);
      expect(result.eligible).toBe(false);
      expect(result.skipReason).toBe('inactive');
    });

    it('should return recently-checked skip reason for recently reported topics', () => {
      const entry = makeEntry({
        lastMessageAt: twoDaysAgo,
        lastDoctorReportAt: new Date('2025-06-15T10:00:00Z').toISOString(),
      });
      const result = getEligibility(entry, now);
      expect(result.eligible).toBe(false);
      expect(result.skipReason).toBe('recently-checked');
    });

    it('should return eligible for active topics', () => {
      const entry = makeEntry({ lastMessageAt: twoDaysAgo });
      const result = getEligibility(entry, now);
      expect(result.eligible).toBe(true);
      expect(result.skipReason).toBeUndefined();
    });
  });

  describe('buildDoctorAllSummary', () => {
    const baseSummary: DoctorAllSummaryData = {
      checkedTopics: [],
      skippedTopics: [],
      postFailures: 0,
      migrationGroups: 0,
      errors: [],
    };

    it('should show empty workspace message when no topics', () => {
      const result = buildDoctorAllSummary(baseSummary);
      expect(result).toContain('No topics registered yet.');
    });

    it('should show all checked with no skipped section', () => {
      const result = buildDoctorAllSummary({
        ...baseSummary,
        checkedTopics: [
          { name: 'Alpha', slug: 'alpha', status: 'checked' },
          { name: 'Beta', slug: 'beta', status: 'checked' },
        ],
      });
      expect(result).toContain('✅ Alpha — checked');
      expect(result).toContain('✅ Beta — checked');
      expect(result).not.toContain('Skipped');
    });

    it('should show both checked and skipped sections', () => {
      const result = buildDoctorAllSummary({
        ...baseSummary,
        checkedTopics: [{ name: 'Alpha', slug: 'alpha', status: 'checked' }],
        skippedTopics: [
          { name: 'Gamma', reason: 'snoozed' },
          { name: 'Delta', reason: 'inactive' },
        ],
      });
      expect(result).toContain('✅ Alpha — checked');
      expect(result).toContain('Skipped');
      expect(result).toContain('💤 Gamma — snoozed');
      expect(result).toContain('🔇 Delta — inactive');
    });

    it('should suppress zero-value post failures', () => {
      const result = buildDoctorAllSummary({
        ...baseSummary,
        checkedTopics: [{ name: 'Alpha', slug: 'alpha', status: 'checked' }],
        postFailures: 0,
      });
      expect(result).not.toContain('failed to post');
    });

    it('should show per-topic names and skip reasons', () => {
      const result = buildDoctorAllSummary({
        ...baseSummary,
        skippedTopics: [
          { name: 'Archived Project', reason: 'archived' },
          { name: 'Snoozed Project', reason: 'snoozed' },
          { name: 'Quiet Project', reason: 'inactive' },
          { name: 'Recent Project', reason: 'recently-checked' },
        ],
      });
      expect(result).toContain('📦 Archived Project — archived');
      expect(result).toContain('💤 Snoozed Project — snoozed');
      expect(result).toContain('🔇 Quiet Project — inactive');
      expect(result).toContain('⏰ Recent Project — recently checked');
    });

    it('should show post-failed topics with warning icon', () => {
      const result = buildDoctorAllSummary({
        ...baseSummary,
        checkedTopics: [{ name: 'Failed Topic', slug: 'failed', status: 'post-failed' }],
        postFailures: 1,
      });
      expect(result).toContain('⚠️ Failed Topic — failed to post');
      expect(result).toContain('1 topic(s) failed to post');
    });

  });
});
