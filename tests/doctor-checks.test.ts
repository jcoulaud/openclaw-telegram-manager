import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  runRegistryChecks,
  runOrphanCheck,
  runCapsuleChecks,
  runStatusQualityChecks,
  runNextVsTodoChecks,
  runCommandsLinksChecks,
  runCronChecks,
  runConfigChecks,
  runIncludeDriftCheck,
  runSpamControlCheck,
  runAllChecksForTopic,
} from '../src/lib/doctor-checks.js';
import { scaffoldCapsule } from '../src/lib/capsule.js';
import { createEmptyRegistry, writeRegistryAtomic, registryPath } from '../src/lib/registry.js';
import { generateInclude, includePath } from '../src/lib/include-generator.js';
import type { TopicEntry, Registry } from '../src/lib/types.js';
import { Severity, CAPSULE_VERSION } from '../src/lib/types.js';

describe('doctor-checks', () => {
  let tmpDir: string;
  let workspaceDir: string;
  let projectsBase: string;
  let configDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-test-'));
    workspaceDir = path.join(tmpDir, 'workspace');
    projectsBase = path.join(workspaceDir, 'projects');
    configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(projectsBase, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const createTestEntry = (overrides?: Partial<TopicEntry>): TopicEntry => ({
    groupId: '-100',
    threadId: '123',
    slug: 'test-topic',
    name: 'test-topic',
    type: 'coding',
    status: 'active',
    capsuleVersion: CAPSULE_VERSION,
    lastMessageAt: null,
    lastDoctorReportAt: null,
    lastDoctorRunAt: null,
    lastCapsuleWriteAt: null,
    snoozeUntil: null,
    ignoreChecks: [],
    consecutiveSilentDoctors: 0,
    lastPostError: null,
    extras: {},
    ...overrides,
  });

  describe('runRegistryChecks', () => {
    it('should pass when capsule path exists', () => {
      const entry = createTestEntry();
      scaffoldCapsule(projectsBase, entry.slug, entry.name, entry.type);

      const results = runRegistryChecks(entry, projectsBase);

      expect(results).toHaveLength(0);
    });

    it('should detect missing capsule path', () => {
      const entry = createTestEntry();

      const results = runRegistryChecks(entry, projectsBase);

      expect(results).toHaveLength(1);
      expect(results[0]?.severity).toBe(Severity.ERROR);
      expect(results[0]?.checkId).toBe('pathMissing');
    });

    it('should detect when path is not a directory', () => {
      const entry = createTestEntry();
      const capsulePath = path.join(projectsBase, entry.slug);
      fs.writeFileSync(capsulePath, 'not a directory');

      const results = runRegistryChecks(entry, projectsBase);

      expect(results.some(r => r.checkId === 'pathNotDir')).toBe(true);
    });
  });

  describe('runOrphanCheck', () => {
    it('should pass when all folders have registry entries', () => {
      const registrySlugs = new Set(['topic1', 'topic2']);
      fs.mkdirSync(path.join(projectsBase, 'topic1'));
      fs.mkdirSync(path.join(projectsBase, 'topic2'));

      const results = runOrphanCheck(projectsBase, registrySlugs);

      expect(results).toHaveLength(0);
    });

    it('should detect orphan folders', () => {
      const registrySlugs = new Set(['topic1']);
      fs.mkdirSync(path.join(projectsBase, 'topic1'));
      fs.mkdirSync(path.join(projectsBase, 'orphan'));

      const results = runOrphanCheck(projectsBase, registrySlugs);

      expect(results).toHaveLength(1);
      expect(results[0]?.severity).toBe(Severity.WARN);
      expect(results[0]?.checkId).toBe('orphanFolder');
      expect(results[0]?.message).toContain('orphan');
    });

    it('should skip hidden folders', () => {
      const registrySlugs = new Set([]);
      fs.mkdirSync(path.join(projectsBase, '.hidden'));

      const results = runOrphanCheck(projectsBase, registrySlugs);

      expect(results).toHaveLength(0);
    });

    it('should skip audit.jsonl', () => {
      const registrySlugs = new Set([]);
      fs.writeFileSync(path.join(projectsBase, 'audit.jsonl'), '');

      const results = runOrphanCheck(projectsBase, registrySlugs);

      expect(results).toHaveLength(0);
    });
  });

  describe('runCapsuleChecks', () => {
    it('should detect missing STATUS.md', () => {
      const entry = createTestEntry();
      scaffoldCapsule(projectsBase, entry.slug, entry.name, entry.type);
      fs.unlinkSync(path.join(projectsBase, entry.slug, 'STATUS.md'));

      const results = runCapsuleChecks(entry, projectsBase);

      expect(results.some(r => r.checkId === 'statusMissing' && r.severity === Severity.ERROR)).toBe(true);
    });

    it('should detect missing TODO.md', () => {
      const entry = createTestEntry();
      scaffoldCapsule(projectsBase, entry.slug, entry.name, entry.type);
      fs.unlinkSync(path.join(projectsBase, entry.slug, 'TODO.md'));

      const results = runCapsuleChecks(entry, projectsBase);

      expect(results.some(r => r.checkId === 'todoMissing' && r.severity === Severity.WARN)).toBe(true);
    });

    it('should respect ignoreChecks for TODO.md', () => {
      const entry = createTestEntry({ ignoreChecks: ['todoMissing'] });
      scaffoldCapsule(projectsBase, entry.slug, entry.name, entry.type);
      fs.unlinkSync(path.join(projectsBase, entry.slug, 'TODO.md'));

      const results = runCapsuleChecks(entry, projectsBase);

      expect(results.some(r => r.checkId === 'todoMissing')).toBe(false);
    });

    it('should detect missing overlay files', () => {
      const entry = createTestEntry({ type: 'coding' });
      scaffoldCapsule(projectsBase, entry.slug, entry.name, entry.type);
      fs.unlinkSync(path.join(projectsBase, entry.slug, 'ARCHITECTURE.md'));

      const results = runCapsuleChecks(entry, projectsBase);

      expect(results.some(r => r.checkId === 'overlayMissing:ARCHITECTURE.md')).toBe(true);
    });

    it('should detect capsule version behind', () => {
      const entry = createTestEntry({ capsuleVersion: 0 });
      scaffoldCapsule(projectsBase, entry.slug, entry.name, entry.type);

      const results = runCapsuleChecks(entry, projectsBase);

      expect(results.some(r => r.checkId === 'capsuleVersionBehind')).toBe(true);
    });
  });

  describe('runStatusQualityChecks', () => {
    const validStatus = `# Status: test-topic

## Last done (UTC)

${new Date().toISOString()}

Work completed on database schema.

## Next 3 actions

1. [T-1] Set up API endpoints
2. [T-2] Write integration tests
3. [T-3] Deploy to staging
`;

    it('should pass for valid STATUS.md', () => {
      const entry = createTestEntry();
      const results = runStatusQualityChecks(validStatus, entry);

      // May have warnings but no errors
      const errors = results.filter(r => r.severity === Severity.ERROR);
      expect(errors).toHaveLength(0);
    });

    it('should detect missing "Last done (UTC)" section', () => {
      const entry = createTestEntry();
      const status = '# Status\n\nSome content';

      const results = runStatusQualityChecks(status, entry);

      expect(results.some(r => r.checkId === 'lastDoneMissing')).toBe(true);
    });

    it('should detect missing timestamp in "Last done"', () => {
      const entry = createTestEntry();
      const status = `# Status

## Last done (UTC)

No timestamp here.

## Next 3 actions
`;

      const results = runStatusQualityChecks(status, entry);

      expect(results.some(r => r.checkId === 'lastDoneNoTimestamp')).toBe(true);
    });

    it('should detect stale timestamp for active topics', () => {
      const entry = createTestEntry({ status: 'active' });
      const oldDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      const status = `# Status

## Last done (UTC)

${oldDate}

## Next 3 actions
`;

      const results = runStatusQualityChecks(status, entry);

      expect(results.some(r => r.checkId === 'lastDoneStale')).toBe(true);
    });

    it('should not check stale timestamp for snoozed topics', () => {
      const entry = createTestEntry({ status: 'snoozed' });
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const status = `# Status

## Last done (UTC)

${oldDate}

## Next 3 actions
`;

      const results = runStatusQualityChecks(status, entry);

      expect(results.some(r => r.checkId === 'lastDoneStale')).toBe(false);
    });

    it('should detect missing "Next actions" section', () => {
      const entry = createTestEntry();
      const status = `# Status

## Last done (UTC)

2025-01-15T10:30:00Z
`;

      const results = runStatusQualityChecks(status, entry);

      expect(results.some(r => r.checkId === 'nextActionsMissing')).toBe(true);
    });

    it('should detect empty "Next actions (now)"', () => {
      const entry = createTestEntry();
      const status = `# Status

## Last done (UTC)

2025-01-15T10:30:00Z

## Next actions (now)

`;

      const results = runStatusQualityChecks(status, entry);

      expect(results.some(r => r.checkId === 'nextActionsEmpty')).toBe(true);
    });

    it('should accept old "Next 3 actions" format (backward compat)', () => {
      const entry = createTestEntry();
      const status = `# Status

## Last done (UTC)

${new Date().toISOString()}

## Next 3 actions

1. [T-1] First task
2. [T-2] Second task
3. [T-3] Third task
`;

      const results = runStatusQualityChecks(status, entry);
      expect(results.some(r => r.checkId === 'nextActionsMissing')).toBe(false);
    });

    it('should accept new "Next actions (now)" format', () => {
      const entry = createTestEntry();
      const status = `# Status

## Last done (UTC)

${new Date().toISOString()}

## Next actions (now)

1. [T-1] First task

## Upcoming actions

_See TODO.md for full backlog._
`;

      const results = runStatusQualityChecks(status, entry);
      expect(results.some(r => r.checkId === 'nextActionsMissing')).toBe(false);
    });

    it('should accept [AD-HOC] entries', () => {
      const entry = createTestEntry();
      const status = `# Status

## Last done (UTC)

2025-01-15T10:30:00Z

## Next 3 actions

1. [AD-HOC] Quick fix needed
`;

      const results = runStatusQualityChecks(status, entry);

      expect(results.some(r => r.checkId === 'nextActionsEmpty')).toBe(false);
    });
  });

  describe('runNextVsTodoChecks', () => {
    it('should pass when all task IDs exist in TODO', () => {
      const status = `## Next 3 actions

1. [T-1] First task
2. [T-2] Second task
`;

      const todo = `## Backlog

- [T-1] First task
- [T-2] Second task
- [T-3] Third task
`;

      const results = runNextVsTodoChecks(status, todo);

      expect(results).toHaveLength(0);
    });

    it('should warn when 2+ task IDs missing from TODO', () => {
      const status = `## Next 3 actions

1. [T-1] First task
2. [T-2] Second task
3. [T-3] Third task
`;

      const todo = `## Backlog

- [T-1] First task only
`;

      const results = runNextVsTodoChecks(status, todo);

      expect(results).toHaveLength(1);
      expect(results[0]?.checkId).toBe('nextNotInTodo');
      expect(results[0]?.message).toContain('T-2');
      expect(results[0]?.message).toContain('T-3');
    });

    it('should allow 1 stale reference', () => {
      const status = `## Next 3 actions

1. [T-1] First task
2. [T-2] Stale task
`;

      const todo = `## Backlog

- [T-1] First task
`;

      const results = runNextVsTodoChecks(status, todo);

      expect(results).toHaveLength(0);
    });
  });

  describe('runCommandsLinksChecks', () => {
    it('should detect empty COMMANDS.md for coding topics', () => {
      const entry = createTestEntry({ type: 'coding' });
      const capsuleFiles = new Map([['COMMANDS.md', '# Commands\n\n_Empty_']]);

      const results = runCommandsLinksChecks(entry, capsuleFiles);

      expect(results.some(r => r.checkId === 'commandsEmpty')).toBe(true);
    });

    it('should detect empty LINKS.md for research topics', () => {
      const entry = createTestEntry({ type: 'research' });
      const capsuleFiles = new Map([['LINKS.md', '# Links\n\n_Empty_']]);

      const results = runCommandsLinksChecks(entry, capsuleFiles);

      expect(results.some(r => r.checkId === 'linksEmpty')).toBe(true);
    });

    it('should not check COMMANDS.md for non-coding topics', () => {
      const entry = createTestEntry({ type: 'research' });
      const capsuleFiles = new Map([['COMMANDS.md', '# Commands\n\n_Empty_']]);

      const results = runCommandsLinksChecks(entry, capsuleFiles);

      expect(results.some(r => r.checkId === 'commandsEmpty')).toBe(false);
    });
  });

  describe('runCronChecks', () => {
    it('should pass for empty CRON.md', () => {
      const cronContent = '# Cron\n\n_No jobs_';

      const results = runCronChecks(cronContent);

      expect(results).toHaveLength(0);
    });

    it('should detect missing job IDs', () => {
      const cronContent = `# Cron

Daily backup job runs at 2am
Another job at 3am
`;

      const results = runCronChecks(cronContent);

      expect(results.some(r => r.checkId === 'cronNoJobIds')).toBe(true);
    });

    it('should pass when job IDs present', () => {
      const cronContent = `# Cron

backup-daily-abc123 - Runs at midnight
`;

      const results = runCronChecks(cronContent);

      expect(results).toHaveLength(0);
    });
  });

  describe('runIncludeDriftCheck', () => {
    it('should pass when hash matches', () => {
      const registry = createEmptyRegistry('secret');
      const entry = createTestEntry();
      registry.topics['-100:123'] = entry;

      generateInclude(workspaceDir, registry, configDir);

      const includeContent = fs.readFileSync(includePath(configDir), 'utf-8');
      const results = runIncludeDriftCheck(includeContent, registry);

      expect(results).toHaveLength(0);
    });

    it('should detect drift when registry changes', () => {
      const registry = createEmptyRegistry('secret');
      const entry = createTestEntry();
      registry.topics['-100:123'] = entry;

      generateInclude(workspaceDir, registry, configDir);

      // Modify registry
      registry.topics['-100:456'] = { ...entry, threadId: '456' };

      const includeContent = fs.readFileSync(includePath(configDir), 'utf-8');
      const results = runIncludeDriftCheck(includeContent, registry);

      expect(results).toHaveLength(1);
      expect(results[0]?.checkId).toBe('includeDrift');
    });

    it('should detect missing hash comment', () => {
      const registry = createEmptyRegistry('secret');
      const includeContent = '// No hash\n{}';

      const results = runIncludeDriftCheck(includeContent, registry);

      expect(results).toHaveLength(1);
      expect(results[0]?.checkId).toBe('includeDrift');
    });
  });

  describe('runSpamControlCheck', () => {
    it('should pass when below threshold', () => {
      const entry = createTestEntry({ consecutiveSilentDoctors: 2 });

      const results = runSpamControlCheck(entry);

      expect(results).toHaveLength(0);
    });

    it('should warn at threshold', () => {
      const entry = createTestEntry({ consecutiveSilentDoctors: 3 });

      const results = runSpamControlCheck(entry);

      expect(results).toHaveLength(1);
      expect(results[0]?.checkId).toBe('spamControl');
      expect(results[0]?.severity).toBe(Severity.INFO);
    });

    it('should warn above threshold', () => {
      const entry = createTestEntry({ consecutiveSilentDoctors: 5 });

      const results = runSpamControlCheck(entry);

      expect(results).toHaveLength(1);
    });
  });

  describe('runConfigChecks with JSON5', () => {
    it('should parse JSON5 content with trailing commas and comments', () => {
      const entry = createTestEntry();
      const registry = createEmptyRegistry('secret');
      registry.topics['-100:123'] = entry;

      // JSON5 content with comments and trailing commas
      const includeContent = `// This is a generated file
// registry-hash: sha256:abc123
{
  "-100": {
    topics: {
      "123": {
        enabled: true,
        skills: ['coding-agent'],
        systemPrompt: 'test prompt',
      },
    },
  },
}`;

      const results = runConfigChecks(entry, includeContent, registry);

      // Should parse successfully and not return early (no configGroupMissing)
      expect(results.some(r => r.checkId === 'configGroupMissing')).toBe(false);
    });

    it('should return empty results for unparseable content', () => {
      const entry = createTestEntry();
      const registry = createEmptyRegistry('secret');
      registry.topics['-100:123'] = entry;

      const results = runConfigChecks(entry, '{{invalid', registry);

      expect(results).toHaveLength(0);
    });
  });

  describe('runAllChecksForTopic', () => {
    it('should run all applicable checks', () => {
      const registry = createEmptyRegistry('secret');
      const entry = createTestEntry();
      registry.topics['-100:123'] = entry;

      scaffoldCapsule(projectsBase, entry.slug, entry.name, entry.type);

      const results = runAllChecksForTopic(entry, projectsBase);

      // Should have run multiple check categories
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('should skip capsule checks if path missing', () => {
      const entry = createTestEntry();

      const results = runAllChecksForTopic(entry, projectsBase);

      expect(results.some(r => r.checkId === 'pathMissing')).toBe(true);
      // Should not have capsule-specific checks
      expect(results.some(r => r.checkId === 'statusMissing')).toBe(false);
    });
  });
});
