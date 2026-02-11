import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleInit } from '../../src/commands/init.js';
import { createEmptyRegistry, writeRegistryAtomic, registryPath, readRegistry } from '../../src/lib/registry.js';
import { validateCapsule } from '../../src/lib/capsule.js';
import { generateInclude, includePath, extractRegistryHash, computeRegistryHash } from '../../src/lib/include-generator.js';
import { runAllChecksForTopic } from '../../src/lib/doctor-checks.js';
import type { CommandContext } from '../../src/commands/help.js';
import { Severity } from '../../src/lib/types.js';
import JSON5 from 'json5';

describe('init flow integration', () => {
  let tmpDir: string;
  let workspaceDir: string;
  let projectsDir: string;
  let configDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-flow-test-'));
    workspaceDir = path.join(tmpDir, 'workspace');
    projectsDir = path.join(workspaceDir, 'projects');
    configDir = path.join(tmpDir, 'config');

    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });

    // Initialize registry
    const registry = createEmptyRegistry('test-secret');
    writeRegistryAtomic(registryPath(workspaceDir), registry);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('end-to-end init flow', () => {
    it('should complete full init workflow', async () => {
      const ctx: CommandContext = {
        workspaceDir,
        configDir,
        userId: 'user123',
        groupId: '-100123',
        threadId: '456',
        rpc: null,
        logger: console,
        messageContext: { topicTitle: 'Test Project' },
      };

      // Step 1: Initialize topic
      const result = await handleInit(ctx, '');
      expect(result.text).toBeDefined();
      expect(result.pin).toBe(true);

      // Step 2: Verify registry entry
      const registry = readRegistry(workspaceDir);
      const entry = registry.topics['-100123:456'];
      expect(entry).toBeDefined();
      expect(entry?.slug).toBe('test-project');
      expect(entry?.type).toBe('coding');
      expect(entry?.status).toBe('active');

      // Step 3: Verify capsule created
      const capsuleDir = path.join(projectsDir, 'test-project');
      expect(fs.existsSync(capsuleDir)).toBe(true);

      // Step 4: Verify capsule structure
      const validation = validateCapsule(projectsDir, 'test-project', 'coding');
      expect(validation.missing).toEqual([]);
      expect(validation.present.length).toBeGreaterThan(0);

      // Step 5: Verify files have content
      const statusPath = path.join(capsuleDir, 'STATUS.md');
      const statusContent = fs.readFileSync(statusPath, 'utf-8');
      expect(statusContent).toContain('test-project');
      expect(statusContent).toContain('Last done (UTC)');
      expect(statusContent).toContain('Next 3 actions');

      // Step 6: Generate include and verify
      generateInclude(workspaceDir, registry, configDir);
      const includeFile = includePath(configDir);
      expect(fs.existsSync(includeFile)).toBe(true);

      const includeContent = fs.readFileSync(includeFile, 'utf-8');
      const parsed = JSON5.parse(includeContent);
      expect(parsed['-100123']).toBeDefined();

      // Step 7: Verify include hash matches
      const hash = extractRegistryHash(includeContent);
      const currentHash = computeRegistryHash(registry.topics);
      expect(hash).toBe(currentHash);

      // Step 8: Run doctor checks
      const checks = runAllChecksForTopic(entry, projectsDir, includeContent, registry);
      const errors = checks.filter(c => c.severity === Severity.ERROR);
      expect(errors).toHaveLength(0);
    });

    it('should handle multiple topics in same group', async () => {
      // First topic
      const ctx1: CommandContext = {
        workspaceDir,
        configDir,
        userId: 'user123',
        groupId: '-100123',
        threadId: '1',
        rpc: null,
        logger: console,
        messageContext: {},
      };

      await handleInit(ctx1, 'topic-one coding');

      // Second topic in same group
      const ctx2: CommandContext = {
        ...ctx1,
        threadId: '2',
      };

      await handleInit(ctx2, 'topic-two research');

      // Verify both topics in registry
      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:1']).toBeDefined();
      expect(registry.topics['-100123:2']).toBeDefined();

      // Verify both capsules exist
      expect(fs.existsSync(path.join(projectsDir, 'topic-one'))).toBe(true);
      expect(fs.existsSync(path.join(projectsDir, 'topic-two'))).toBe(true);

      // Generate include and verify grouping
      generateInclude(workspaceDir, registry, configDir);
      const includeContent = fs.readFileSync(includePath(configDir), 'utf-8');
      const parsed = JSON5.parse(includeContent);

      const group = parsed['-100123'] as { topics: Record<string, unknown> };
      expect(group.topics['1']).toBeDefined();
      expect(group.topics['2']).toBeDefined();
    });

    it('should handle topics in different groups', async () => {
      // First group
      const ctx1: CommandContext = {
        workspaceDir,
        configDir,
        userId: 'user123',
        groupId: '-100111',
        threadId: '1',
        rpc: null,
        logger: console,
        messageContext: {},
      };

      await handleInit(ctx1, 'group1-topic');

      // Second group
      const ctx2: CommandContext = {
        ...ctx1,
        groupId: '-100222',
        threadId: '2',
      };

      await handleInit(ctx2, 'group2-topic');

      // Generate include and verify separate groups
      const registry = readRegistry(workspaceDir);
      generateInclude(workspaceDir, registry, configDir);
      const includeContent = fs.readFileSync(includePath(configDir), 'utf-8');
      const parsed = JSON5.parse(includeContent);

      expect(parsed['-100111']).toBeDefined();
      expect(parsed['-100222']).toBeDefined();
    });

    it('should handle first-user admin promotion', async () => {
      const ctx: CommandContext = {
        workspaceDir,
        configDir,
        userId: 'first-user',
        groupId: '-100123',
        threadId: '1',
        rpc: null,
        logger: console,
        messageContext: {},
      };

      const result = await handleInit(ctx, 'first-topic');

      expect(result.text).toContain('first user');
      expect(result.text).toContain('admin');

      const registry = readRegistry(workspaceDir);
      expect(registry.topicManagerAdmins).toContain('first-user');
    });

    it('should enforce authorization after first user', async () => {
      // First user
      const ctx1: CommandContext = {
        workspaceDir,
        configDir,
        userId: 'admin',
        groupId: '-100123',
        threadId: '1',
        rpc: null,
        logger: console,
        messageContext: {},
      };

      await handleInit(ctx1, 'first-topic');

      // Second user (non-admin)
      const ctx2: CommandContext = {
        ...ctx1,
        userId: 'regular-user',
        threadId: '2',
      };

      const result = await handleInit(ctx2, 'second-topic');

      expect(result.text).toContain('Not authorized');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:2']).toBeUndefined();
    });

    it('should handle different topic types with correct overlays', async () => {
      const types = [
        { type: 'coding', overlays: ['ARCHITECTURE.md', 'DEPLOY.md'] },
        { type: 'research', overlays: ['SOURCES.md', 'FINDINGS.md'] },
        { type: 'marketing', overlays: ['CAMPAIGNS.md', 'METRICS.md'] },
      ];

      let threadNum = 1;
      for (const { type, overlays } of types) {
        const ctx: CommandContext = {
          workspaceDir,
          configDir,
          userId: 'user123',
          groupId: '-100123',
          threadId: String(threadNum++),
          rpc: null,
          logger: console,
          messageContext: {},
        };

        await handleInit(ctx, `${type}-topic ${type}`);

        const capsuleDir = path.join(projectsDir, `${type}-topic`);
        for (const overlay of overlays) {
          expect(fs.existsSync(path.join(capsuleDir, overlay))).toBe(true);
        }
      }
    });

    it('should maintain registry consistency through multiple operations', async () => {
      // Create multiple topics
      for (let i = 1; i <= 3; i++) {
        const ctx: CommandContext = {
          workspaceDir,
          configDir,
          userId: 'user123',
          groupId: '-100123',
          threadId: String(i),
          rpc: null,
          logger: console,
          messageContext: {},
        };

        await handleInit(ctx, `topic-${i}`);
      }

      // Verify registry integrity
      const registry = readRegistry(workspaceDir);
      expect(Object.keys(registry.topics)).toHaveLength(3);

      // Generate include
      generateInclude(workspaceDir, registry, configDir);

      // Verify include matches registry
      const includeContent = fs.readFileSync(includePath(configDir), 'utf-8');
      const hash = extractRegistryHash(includeContent);
      const currentHash = computeRegistryHash(registry.topics);

      expect(hash).toBe(currentHash);
    });

    it('should create valid capsule files readable by doctor checks', async () => {
      const ctx: CommandContext = {
        workspaceDir,
        configDir,
        userId: 'user123',
        groupId: '-100123',
        threadId: '1',
        rpc: null,
        logger: console,
        messageContext: {},
      };

      await handleInit(ctx, 'doctor-test');

      const registry = readRegistry(workspaceDir);
      const entry = registry.topics['-100123:1'];

      expect(entry).toBeDefined();

      // Run all doctor checks
      const checks = runAllChecksForTopic(entry!, projectsDir);

      // Should have no critical errors on fresh capsule
      const criticalErrors = checks.filter(c =>
        c.severity === Severity.ERROR &&
        !c.checkId.includes('Empty') // Empty checks are warnings/info
      );

      expect(criticalErrors).toHaveLength(0);
    });

    it('should handle slug collision gracefully', async () => {
      // First topic
      const ctx1: CommandContext = {
        workspaceDir,
        configDir,
        userId: 'user123',
        groupId: '-100123',
        threadId: '1',
        rpc: null,
        logger: console,
        messageContext: {},
      };

      await handleInit(ctx1, 'popular-name');

      // Second topic with same slug
      const ctx2: CommandContext = {
        ...ctx1,
        groupId: '-100456',
        threadId: '2',
      };

      const result = await handleInit(ctx2, 'popular-name');

      expect(result.text).toContain('taken');

      const registry = readRegistry(workspaceDir);
      const entry = registry.topics['-100456:2'];

      // Should have created with different slug
      expect(entry).toBeDefined();
      expect(entry?.slug).not.toBe('popular-name');
      expect(fs.existsSync(path.join(projectsDir, entry!.slug))).toBe(true);
    });

    it('should maintain atomic operations even with failures', async () => {
      const ctx: CommandContext = {
        workspaceDir,
        configDir,
        userId: 'user123',
        groupId: '-100123',
        threadId: '1',
        rpc: null,
        logger: console,
        messageContext: {},
      };

      // Create a directory that will cause collision
      const collisionDir = path.join(projectsDir, 'collision-test');
      fs.mkdirSync(collisionDir);

      const result = await handleInit(ctx, 'collision-test');

      // Should handle collision
      expect(result.text).toBeDefined();

      // Original directory should still exist
      expect(fs.existsSync(collisionDir)).toBe(true);
    });
  });

  describe('workflow validation', () => {
    it('should support typical user workflow', async () => {
      // 1. First user initializes first topic
      const adminCtx: CommandContext = {
        workspaceDir,
        configDir,
        userId: 'admin',
        groupId: '-100123',
        threadId: '1',
        rpc: null,
        logger: console,
        messageContext: { topicTitle: 'Backend Development' },
      };

      const initResult = await handleInit(adminCtx, '');
      expect(initResult.text).toContain('first user');

      // 2. Verify admin was added
      let registry = readRegistry(workspaceDir);
      expect(registry.topicManagerAdmins).toContain('admin');

      // 3. Admin creates another topic
      adminCtx.threadId = '2';
      adminCtx.messageContext = { topicTitle: 'Frontend Development' };
      await handleInit(adminCtx, '');

      // 4. Generate include for topics
      registry = readRegistry(workspaceDir);
      generateInclude(workspaceDir, registry, configDir);

      // 5. Verify include is valid
      const includeContent = fs.readFileSync(includePath(configDir), 'utf-8');
      const parsed = JSON5.parse(includeContent);

      const group = parsed['-100123'] as { topics: Record<string, { enabled: boolean }> };
      expect(group.topics['1']?.enabled).toBe(true);
      expect(group.topics['2']?.enabled).toBe(true);

      // 6. Run health checks on all topics
      for (const [key, entry] of Object.entries(registry.topics)) {
        const checks = runAllChecksForTopic(entry, projectsDir, includeContent, registry);
        const errors = checks.filter(c => c.severity === Severity.ERROR);
        expect(errors.length).toBe(0);
      }
    });
  });
});
