import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import JSON5 from 'json5';
import {
  computeRegistryHash,
  buildIncludeObject,
  generateInclude,
  extractRegistryHash,
  includePath,
  getSystemPromptTemplate,
} from '../src/lib/include-generator.js';
import { createEmptyRegistry, writeRegistryAtomic, registryPath } from '../src/lib/registry.js';
import type { Registry, TopicEntry } from '../src/lib/types.js';

describe('include-generator', () => {
  let tmpDir: string;
  let workspaceDir: string;
  let configDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'include-test-'));
    workspaceDir = path.join(tmpDir, 'workspace');
    configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(path.join(workspaceDir, 'projects'), { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('computeRegistryHash', () => {
    it('should compute consistent hash for same topics', () => {
      const topics: Registry['topics'] = {
        '-100:123': {
          groupId: '-100',
          threadId: '123',
          name: 'test',
          slug: 'test',
          type: 'coding',
          status: 'active',
          capsuleVersion: 1,
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
        },
      };

      const hash1 = computeRegistryHash(topics);
      const hash2 = computeRegistryHash(topics);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 hex
    });

    it('should produce different hash for different topics', () => {
      const topics1: Registry['topics'] = {
        '-100:123': {
          groupId: '-100',
          threadId: '123',
          name: 'test',
          slug: 'test',
          type: 'coding',
          status: 'active',
          capsuleVersion: 1,
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
        },
      };

      const topics2: Registry['topics'] = {
        '-100:456': {
          ...topics1['-100:123']!,
          threadId: '456',
          name: 'different',
          slug: 'different',
        },
      };

      const hash1 = computeRegistryHash(topics1);
      const hash2 = computeRegistryHash(topics2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty topics', () => {
      const hash = computeRegistryHash({});
      expect(hash).toHaveLength(64);
    });

    it('should ignore volatile fields like lastMessageAt', () => {
      const base: Registry['topics'] = {
        '-100:123': {
          groupId: '-100',
          threadId: '123',
          name: 'test',
          slug: 'test',
          type: 'coding',
          status: 'active',
          capsuleVersion: 1,
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
        },
      };

      const withUpdatedTimestamps: Registry['topics'] = {
        '-100:123': {
          ...base['-100:123']!,
          lastMessageAt: '2026-01-01T00:00:00Z',
          lastDoctorReportAt: '2026-01-01T00:00:00Z',
          lastDoctorRunAt: '2026-01-01T00:00:00Z',
          lastDailyReportAt: '2026-01-01T00:00:00Z',
          consecutiveSilentDoctors: 5,
          lastPostError: 'some error',
          lastCapsuleWriteAt: '2026-01-01T00:00:00Z',
        },
      };

      expect(computeRegistryHash(base)).toBe(computeRegistryHash(withUpdatedTimestamps));
    });
  });

  describe('getSystemPromptTemplate', () => {
    it('should include name in prompt', () => {
      const prompt = getSystemPromptTemplate('my-topic', 'my-topic', '/workspace');
      expect(prompt).toContain('my-topic');
    });

    it('should include absolute workspace path', () => {
      const prompt = getSystemPromptTemplate('test', 'test', '/absolute/path');
      expect(prompt).toContain('/absolute/path/projects/test');
    });

    it('should include determinism rules', () => {
      const prompt = getSystemPromptTemplate('test', 'test', '/workspace');
      expect(prompt).toContain('STATUS.md');
      expect(prompt).toContain('TODO.md');
      expect(prompt).toContain('COMMANDS.md');
      expect(prompt).toContain('Determinism rules');
    });
  });

  describe('buildIncludeObject', () => {
    it('should build valid include object', () => {
      const registry = createEmptyRegistry('secret');
      const entry: TopicEntry = {
        groupId: '-100',
        threadId: '123',
        name: 'test-topic',
        slug: 'test-topic',
        type: 'coding',
        status: 'active',
        capsuleVersion: 1,
        lastMessageAt: null,
        lastDoctorReportAt: null,
        lastDoctorRunAt: null,
        lastDailyReportAt: null,
        snoozeUntil: null,

        consecutiveSilentDoctors: 0,
        lastPostError: null,
        cronJobId: null,
        extras: {},
      };
      registry.topics['-100:123'] = entry;

      const obj = buildIncludeObject(registry, workspaceDir);

      expect(obj['-100']).toBeDefined();
      expect(obj['-100']).toHaveProperty('topics');
      const topics = obj['-100'] as { topics: Record<string, unknown> };
      expect(topics.topics['123']).toBeDefined();
    });

    it('should set enabled=false for archived topics', () => {
      const registry = createEmptyRegistry('secret');
      const entry: TopicEntry = {
        groupId: '-100',
        threadId: '123',
        name: 'archived',
        slug: 'archived',
        type: 'coding',
        status: 'archived',
        capsuleVersion: 1,
        lastMessageAt: null,
        lastDoctorReportAt: null,
        lastDoctorRunAt: null,
        lastDailyReportAt: null,
        snoozeUntil: null,

        consecutiveSilentDoctors: 0,
        lastPostError: null,
        cronJobId: null,
        extras: {},
      };
      registry.topics['-100:123'] = entry;

      const obj = buildIncludeObject(registry, workspaceDir);

      const topics = obj['-100'] as { topics: Record<string, { enabled: boolean }> };
      expect(topics.topics['123']?.enabled).toBe(false);
    });

    it('should set enabled=true for active topics', () => {
      const registry = createEmptyRegistry('secret');
      const entry: TopicEntry = {
        groupId: '-100',
        threadId: '123',
        name: 'active',
        slug: 'active',
        type: 'coding',
        status: 'active',
        capsuleVersion: 1,
        lastMessageAt: null,
        lastDoctorReportAt: null,
        lastDoctorRunAt: null,
        lastDailyReportAt: null,
        snoozeUntil: null,

        consecutiveSilentDoctors: 0,
        lastPostError: null,
        cronJobId: null,
        extras: {},
      };
      registry.topics['-100:123'] = entry;

      const obj = buildIncludeObject(registry, workspaceDir);

      const topics = obj['-100'] as { topics: Record<string, { enabled: boolean }> };
      expect(topics.topics['123']?.enabled).toBe(true);
    });

    it('should assign skills based on type', () => {
      const registry = createEmptyRegistry('secret');

      const coding: TopicEntry = {
        groupId: '-100',
        threadId: '1',
        name: 'coding',
        slug: 'coding',
        type: 'coding',
        status: 'active',
        capsuleVersion: 1,
        lastMessageAt: null,
        lastDoctorReportAt: null,
        lastDoctorRunAt: null,
        lastDailyReportAt: null,
        snoozeUntil: null,

        consecutiveSilentDoctors: 0,
        lastPostError: null,
        cronJobId: null,
        extras: {},
      };

      const research: TopicEntry = {
        ...coding,
        threadId: '2',
        name: 'research',
        slug: 'research',
        type: 'research',
      };

      const marketing: TopicEntry = {
        ...coding,
        threadId: '3',
        name: 'marketing',
        slug: 'marketing',
        type: 'marketing',
      };

      registry.topics['-100:1'] = coding;
      registry.topics['-100:2'] = research;
      registry.topics['-100:3'] = marketing;

      const obj = buildIncludeObject(registry, workspaceDir);

      type TopicConfig = { enabled: boolean; skills: string[]; systemPrompt: string };
      const topics = obj['-100'] as { topics: Record<string, TopicConfig> };

      expect(topics.topics['1']?.skills).toEqual(['coding-agent']);
      expect(topics.topics['2']?.skills).toEqual(['research-agent']);
      expect(topics.topics['3']?.skills).toEqual(['marketing-agent']);
    });

    it('should preserve group-level settings from existingInclude', () => {
      const registry = createEmptyRegistry('secret');
      const entry: TopicEntry = {
        groupId: '-100',
        threadId: '123',
        name: 'test-topic',
        slug: 'test-topic',
        type: 'coding',
        status: 'active',
        capsuleVersion: 1,
        lastMessageAt: null,
        lastDoctorReportAt: null,
        lastDoctorRunAt: null,
        lastDailyReportAt: null,
        snoozeUntil: null,

        consecutiveSilentDoctors: 0,
        lastPostError: null,
        cronJobId: null,
        extras: {},
      };
      registry.topics['-100:123'] = entry;

      const existingInclude = {
        '-100': {
          requireMention: false,
          topics: {
            '999': { enabled: true, skills: ['old-skill'], systemPrompt: 'old' },
          },
        },
      };

      const obj = buildIncludeObject(registry, workspaceDir, existingInclude);

      const group = obj['-100'] as Record<string, unknown>;
      // requireMention should be preserved
      expect(group.requireMention).toBe(false);
      // topics should come from the registry, not old include
      const topics = group.topics as Record<string, unknown>;
      expect(topics['123']).toBeDefined();
      // stale topic 999 should not be carried over
      expect(topics['999']).toBeUndefined();
    });

    it('should not carry over stale topics from existingInclude', () => {
      const registry = createEmptyRegistry('secret');
      // No topics in registry for group -200

      const existingInclude = {
        '-200': {
          requireMention: true,
          topics: {
            '42': { enabled: true, skills: [], systemPrompt: 'stale' },
          },
        },
      };

      const obj = buildIncludeObject(registry, workspaceDir, existingInclude);

      // Group -200 should exist with preserved settings but empty topics
      const group = obj['-200'] as Record<string, unknown>;
      expect(group.requireMention).toBe(true);
      const topics = group.topics as Record<string, unknown>;
      expect(topics['42']).toBeUndefined();
      expect(Object.keys(topics)).toHaveLength(0);
    });

    it('should work with empty existingInclude', () => {
      const registry = createEmptyRegistry('secret');
      const entry: TopicEntry = {
        groupId: '-100',
        threadId: '1',
        name: 'test',
        slug: 'test',
        type: 'coding',
        status: 'active',
        capsuleVersion: 1,
        lastMessageAt: null,
        lastDoctorReportAt: null,
        lastDoctorRunAt: null,
        lastDailyReportAt: null,
        snoozeUntil: null,

        consecutiveSilentDoctors: 0,
        lastPostError: null,
        cronJobId: null,
        extras: {},
      };
      registry.topics['-100:1'] = entry;

      const obj = buildIncludeObject(registry, workspaceDir, {});

      const group = obj['-100'] as Record<string, unknown>;
      expect(group.topics).toBeDefined();
      const topics = group.topics as Record<string, unknown>;
      expect(topics['1']).toBeDefined();
    });

    it('should work with null existingInclude', () => {
      const registry = createEmptyRegistry('secret');
      const entry: TopicEntry = {
        groupId: '-100',
        threadId: '1',
        name: 'test',
        slug: 'test',
        type: 'coding',
        status: 'active',
        capsuleVersion: 1,
        lastMessageAt: null,
        lastDoctorReportAt: null,
        lastDoctorRunAt: null,
        lastDailyReportAt: null,
        snoozeUntil: null,

        consecutiveSilentDoctors: 0,
        lastPostError: null,
        cronJobId: null,
        extras: {},
      };
      registry.topics['-100:1'] = entry;

      const obj = buildIncludeObject(registry, workspaceDir, null);

      const group = obj['-100'] as Record<string, unknown>;
      expect(group.topics).toBeDefined();
    });

    it('should group topics by groupId', () => {
      const registry = createEmptyRegistry('secret');

      const entry1: TopicEntry = {
        groupId: '-100',
        threadId: '1',
        name: 'topic1',
        slug: 'topic1',
        type: 'coding',
        status: 'active',
        capsuleVersion: 1,
        lastMessageAt: null,
        lastDoctorReportAt: null,
        lastDoctorRunAt: null,
        lastDailyReportAt: null,
        snoozeUntil: null,

        consecutiveSilentDoctors: 0,
        lastPostError: null,
        cronJobId: null,
        extras: {},
      };

      const entry2: TopicEntry = {
        ...entry1,
        groupId: '-200',
        threadId: '2',
        name: 'topic2',
        slug: 'topic2',
      };

      registry.topics['-100:1'] = entry1;
      registry.topics['-200:2'] = entry2;

      const obj = buildIncludeObject(registry, workspaceDir);

      expect(obj['-100']).toBeDefined();
      expect(obj['-200']).toBeDefined();
    });
  });

  describe('generateInclude', () => {
    it('should generate valid JSON5 file', () => {
      const registry = createEmptyRegistry('secret');
      const entry: TopicEntry = {
        groupId: '-100',
        threadId: '123',
        name: 'test',
        slug: 'test',
        type: 'coding',
        status: 'active',
        capsuleVersion: 1,
        lastMessageAt: null,
        lastDoctorReportAt: null,
        lastDoctorRunAt: null,
        lastDailyReportAt: null,
        snoozeUntil: null,

        consecutiveSilentDoctors: 0,
        lastPostError: null,
        cronJobId: null,
        extras: {},
      };
      registry.topics['-100:123'] = entry;

      generateInclude(workspaceDir, registry, configDir);

      const includeFile = includePath(configDir);
      expect(fs.existsSync(includeFile)).toBe(true);

      const content = fs.readFileSync(includeFile, 'utf-8');
      const parsed = JSON5.parse(content);

      expect(parsed['-100']).toBeDefined();
    });

    it('should include registry hash in header', () => {
      const registry = createEmptyRegistry('secret');
      generateInclude(workspaceDir, registry, configDir);

      const includeFile = includePath(configDir);
      const content = fs.readFileSync(includeFile, 'utf-8');

      expect(content).toMatch(/\/\/ registry-hash: sha256:[a-f0-9]{64}/);
    });

    it('should create backup of existing file', () => {
      const registry = createEmptyRegistry('secret');

      // Generate first time
      generateInclude(workspaceDir, registry, configDir);

      // Generate again
      generateInclude(workspaceDir, registry, configDir);

      const bakPath = includePath(configDir) + '.bak';
      expect(fs.existsSync(bakPath)).toBe(true);
    });

    it('should set correct file permissions', () => {
      const registry = createEmptyRegistry('secret');
      generateInclude(workspaceDir, registry, configDir);

      const includeFile = includePath(configDir);
      const stat = fs.statSync(includeFile);
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('should use atomic write', () => {
      const registry = createEmptyRegistry('secret');
      generateInclude(workspaceDir, registry, configDir);

      const tmpPath = includePath(configDir) + '.tmp';
      expect(fs.existsSync(tmpPath)).toBe(false);
    });

    it('should validate round-trip integrity', () => {
      const registry = createEmptyRegistry('secret');
      const entry: TopicEntry = {
        groupId: '-100',
        threadId: '123',
        name: 'test',
        slug: 'test',
        type: 'research',
        status: 'snoozed',
        capsuleVersion: 1,
        lastMessageAt: '2025-01-01T00:00:00Z',
        lastDoctorReportAt: null,
        lastDoctorRunAt: null,
        lastDailyReportAt: null,
        snoozeUntil: '2025-12-31T23:59:59Z',
        consecutiveSilentDoctors: 0,
        lastPostError: null,
        cronJobId: null,
        extras: {},
      };
      registry.topics['-100:123'] = entry;

      generateInclude(workspaceDir, registry, configDir);

      const includeFile = includePath(configDir);
      const content = fs.readFileSync(includeFile, 'utf-8');

      // Should be parseable
      expect(() => JSON5.parse(content)).not.toThrow();
    });

    it('should include generation comment', () => {
      const registry = createEmptyRegistry('secret');
      generateInclude(workspaceDir, registry, configDir);

      const includeFile = includePath(configDir);
      const content = fs.readFileSync(includeFile, 'utf-8');

      expect(content).toContain('// This file is generated by telegram-manager');
      expect(content).toContain('// Rebuild from:');
    });
  });

  describe('extractRegistryHash', () => {
    it('should extract hash from valid content', () => {
      const content = `// This file is generated
// registry-hash: sha256:abc123def456
{}`;

      const hash = extractRegistryHash(content);
      expect(hash).toBe('abc123def456');
    });

    it('should return null if no hash found', () => {
      const content = `// This file is generated
{}`;

      const hash = extractRegistryHash(content);
      expect(hash).toBeNull();
    });

    it('should handle multiline content', () => {
      const content = `// Line 1
// Line 2
// registry-hash: sha256:1234567890abcdef
// Line 4
{}`;

      const hash = extractRegistryHash(content);
      expect(hash).toBe('1234567890abcdef');
    });
  });

  describe('includePath', () => {
    it('should return correct path', () => {
      const result = includePath(configDir);
      expect(result).toBe(path.join(configDir, 'telegram-manager.generated.groups.json5'));
    });
  });

  describe('integration with registry', () => {
    it('should generate include from persisted registry', () => {
      const registry = createEmptyRegistry('secret');
      const entry: TopicEntry = {
        groupId: '-100',
        threadId: '123',
        name: 'integrated',
        slug: 'integrated',
        type: 'coding',
        status: 'active',
        capsuleVersion: 1,
        lastMessageAt: null,
        lastDoctorReportAt: null,
        lastDoctorRunAt: null,
        lastDailyReportAt: null,
        snoozeUntil: null,

        consecutiveSilentDoctors: 0,
        lastPostError: null,
        cronJobId: null,
        extras: {},
      };
      registry.topics['-100:123'] = entry;

      // Write registry
      const regPath = registryPath(workspaceDir);
      writeRegistryAtomic(regPath, registry);

      // Generate include
      generateInclude(workspaceDir, registry, configDir);

      // Verify
      const includeFile = includePath(configDir);
      const content = fs.readFileSync(includeFile, 'utf-8');
      const parsed = JSON5.parse(content);

      expect(parsed['-100']).toBeDefined();
      const topics = parsed['-100'] as { topics: Record<string, { enabled: boolean }> };
      expect(topics.topics['123']).toBeDefined();
    });
  });
});
