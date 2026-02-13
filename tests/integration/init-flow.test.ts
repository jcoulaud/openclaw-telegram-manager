import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleInit, handleInitInteractive, handleInitTypeSelect, handleInitNameConfirm } from '../../src/commands/init.js';
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

      // Step 2: Verify registry entry
      const registry = readRegistry(workspaceDir);
      const entry = registry.topics['-100123:456'];
      expect(entry).toBeDefined();
      expect(entry?.slug).toBe('t-456');
      expect(entry?.name).toBe('Test Project');
      expect(entry?.type).toBe('coding');
      expect(entry?.status).toBe('active');

      // Step 3: Verify capsule created
      const capsuleDir = path.join(projectsDir, 't-456');
      expect(fs.existsSync(capsuleDir)).toBe(true);

      // Step 4: Verify capsule structure
      const validation = validateCapsule(projectsDir, 't-456', 'coding');
      expect(validation.missing).toEqual([]);
      expect(validation.present.length).toBeGreaterThan(0);

      // Step 5: Verify files have content
      const statusPath = path.join(capsuleDir, 'STATUS.md');
      const statusContent = fs.readFileSync(statusPath, 'utf-8');
      expect(statusContent).toContain('Test Project');
      expect(statusContent).toContain('Last done (UTC)');
      expect(statusContent).toContain('Next actions (now)');

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
      expect(registry.topics['-100123:1']?.slug).toBe('t-1');
      expect(registry.topics['-100123:1']?.name).toBe('topic-one');
      expect(registry.topics['-100123:2']?.slug).toBe('t-2');
      expect(registry.topics['-100123:2']?.name).toBe('topic-two');

      // Verify both capsules exist
      expect(fs.existsSync(path.join(projectsDir, 't-1'))).toBe(true);
      expect(fs.existsSync(path.join(projectsDir, 't-2'))).toBe(true);

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

      // Verify slugs are auto-generated
      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100111:1']?.slug).toBe('t-1');
      expect(registry.topics['-100222:2']?.slug).toBe('t-2');

      // Generate include and verify separate groups
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
          threadId: String(threadNum),
          rpc: null,
          logger: console,
          messageContext: {},
        };

        await handleInit(ctx, `${type}-topic ${type}`);

        const capsuleDir = path.join(projectsDir, `t-${threadNum}`);
        for (const overlay of overlays) {
          expect(fs.existsSync(path.join(capsuleDir, overlay))).toBe(true);
        }

        threadNum++;
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

      // Verify slugs are auto-generated
      for (let i = 1; i <= 3; i++) {
        expect(registry.topics[`-100123:${i}`]?.slug).toBe(`t-${i}`);
      }

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
      expect(entry?.slug).toBe('t-1');
      expect(entry?.name).toBe('doctor-test');

      // Run all doctor checks
      const checks = runAllChecksForTopic(entry!, projectsDir);

      // Should have no critical errors on fresh capsule
      const criticalErrors = checks.filter(c =>
        c.severity === Severity.ERROR &&
        !c.checkId.includes('Empty') // Empty checks are warnings/info
      );

      expect(criticalErrors).toHaveLength(0);
    });

    it('should generate unique slugs for different threadIds', async () => {
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

      await handleInit(ctx1, 'same-name');

      // Second topic with different threadId
      const ctx2: CommandContext = {
        ...ctx1,
        groupId: '-100456',
        threadId: '2',
      };

      await handleInit(ctx2, 'same-name');

      const registry = readRegistry(workspaceDir);
      const entry1 = registry.topics['-100123:1'];
      const entry2 = registry.topics['-100456:2'];

      expect(entry1).toBeDefined();
      expect(entry2).toBeDefined();
      expect(entry1?.slug).toBe('t-1');
      expect(entry2?.slug).toBe('t-2');
      expect(entry1?.slug).not.toBe(entry2?.slug);

      // Both capsule dirs should exist
      expect(fs.existsSync(path.join(projectsDir, 't-1'))).toBe(true);
      expect(fs.existsSync(path.join(projectsDir, 't-2'))).toBe(true);
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

      // Create a directory at the auto-generated slug path to cause collision
      const collisionDir = path.join(projectsDir, 't-1');
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

      // 2. Verify admin was added
      let registry = readRegistry(workspaceDir);
      expect(registry.topicManagerAdmins).toContain('admin');

      // Verify auto-generated slug
      expect(registry.topics['-100123:1']?.slug).toBe('t-1');
      expect(registry.topics['-100123:1']?.name).toBe('Backend Development');

      // 3. Admin creates another topic
      adminCtx.threadId = '2';
      adminCtx.messageContext = { topicTitle: 'Frontend Development' };
      await handleInit(adminCtx, '');

      // Verify second topic
      registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:2']?.slug).toBe('t-2');
      expect(registry.topics['-100123:2']?.name).toBe('Frontend Development');

      // 4. Generate include for topics
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

  describe('interactive init flow', () => {
    it('should complete full interactive init: type pick → confirm → registered', async () => {
      const ctx: CommandContext = {
        workspaceDir,
        configDir,
        userId: 'user123',
        groupId: '-100123',
        threadId: '456',
        rpc: null,
        logger: console,
        messageContext: { topicTitle: 'Interactive Project' },
      };

      // Step 1: call handleInitInteractive with no args → type picker
      const step1 = await handleInitInteractive(ctx, '');
      expect(step1.text).toContain('Pick a topic type');
      expect(step1.inlineKeyboard).toBeDefined();

      const rows = step1.inlineKeyboard!.inline_keyboard;
      expect(rows).toHaveLength(2);
      expect(rows[0][0].text).toBe('Coding');
      expect(rows[0][1].text).toBe('Research');
      expect(rows[1][0].text).toBe('Marketing');
      expect(rows[1][1].text).toBe('Custom');

      // Step 2: call handleInitTypeSelect → name confirmation
      const step2 = await handleInitTypeSelect(ctx, 'research');
      expect(step2.text).toContain('Interactive Project');
      expect(step2.text).toContain('research');
      expect(step2.inlineKeyboard).toBeDefined();
      expect(step2.inlineKeyboard!.inline_keyboard[0][0].text).toBe('Use this name');

      // Topic should NOT be registered yet
      let registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']).toBeUndefined();

      // Step 3: call handleInitNameConfirm → topic registered
      const step3 = await handleInitNameConfirm(ctx, 'research');
      expect(step3.text).toContain('Interactive Project');

      // Verify registry
      registry = readRegistry(workspaceDir);
      const entry = registry.topics['-100123:456'];
      expect(entry).toBeDefined();
      expect(entry?.slug).toBe('t-456');
      expect(entry?.name).toBe('Interactive Project');
      expect(entry?.type).toBe('research');
      expect(entry?.status).toBe('active');

      // Verify capsule created
      const capsuleDir = path.join(projectsDir, 't-456');
      expect(fs.existsSync(capsuleDir)).toBe(true);

      const validation = validateCapsule(projectsDir, 't-456', 'research');
      expect(validation.missing).toEqual([]);
    });

    it('should handle auth failure between type select and confirm', async () => {
      const ctx: CommandContext = {
        workspaceDir,
        configDir,
        userId: 'user123',
        groupId: '-100123',
        threadId: '456',
        rpc: null,
        logger: console,
        messageContext: { topicTitle: 'Auth Test' },
      };

      // Step 1 succeeds (first user, auto-admin bootstrap not yet applied)
      const step1 = await handleInitInteractive(ctx, '');
      expect(step1.inlineKeyboard).toBeDefined();

      // Step 2: type select still succeeds (no admin yet, first-user bootstrap)
      const step2 = await handleInitTypeSelect(ctx, 'coding');
      expect(step2.inlineKeyboard).toBeDefined();

      // Meanwhile someone else becomes first user
      const otherCtx: CommandContext = {
        ...ctx,
        userId: 'other-user',
        threadId: '999',
      };
      await handleInit(otherCtx, 'other-topic');

      // Now user123 is no longer authorized (not admin, not first user)
      const step3 = await handleInitNameConfirm(ctx, 'coding');
      expect(step3.text).toContain('Not authorized');
    });

    it('should handle auth failure between picker and type select', async () => {
      const ctx: CommandContext = {
        workspaceDir,
        configDir,
        userId: 'user123',
        groupId: '-100123',
        threadId: '456',
        rpc: null,
        logger: console,
        messageContext: { topicTitle: 'Auth Test' },
      };

      // Step 1 succeeds
      const step1 = await handleInitInteractive(ctx, '');
      expect(step1.inlineKeyboard).toBeDefined();

      // Meanwhile someone else becomes first user
      const otherCtx: CommandContext = {
        ...ctx,
        userId: 'other-user',
        threadId: '999',
      };
      await handleInit(otherCtx, 'other-topic');

      // Step 2: type select detects auth failure
      const step2 = await handleInitTypeSelect(ctx, 'coding');
      expect(step2.text).toContain('Not authorized');
    });

    it('should handle already-registered between type select and confirm', async () => {
      const ctx: CommandContext = {
        workspaceDir,
        configDir,
        userId: 'user123',
        groupId: '-100123',
        threadId: '456',
        rpc: null,
        logger: console,
        messageContext: { topicTitle: 'Race Test' },
      };

      // Step 1 succeeds
      const step1 = await handleInitInteractive(ctx, '');
      expect(step1.inlineKeyboard).toBeDefined();

      // Step 2: type select succeeds
      const step2 = await handleInitTypeSelect(ctx, 'coding');
      expect(step2.inlineKeyboard).toBeDefined();

      // Meanwhile topic gets registered via direct init
      await handleInit(ctx, 'race-test');

      // Step 3: confirm detects already registered
      const step3 = await handleInitNameConfirm(ctx, 'coding');
      expect(step3.text).toContain('already registered');
    });

    it('should complete full 3-step flow with postFn (all HTML messages posted)', async () => {
      const postFn = vi.fn().mockResolvedValue(undefined);
      const ctx: CommandContext = {
        workspaceDir,
        configDir,
        userId: 'user123',
        groupId: '-100123',
        threadId: '456',
        rpc: null,
        logger: console,
        messageContext: { topicTitle: 'PostFn Project' },
        postFn,
      };

      // Step 1: type picker — postFn receives HTML welcome + keyboard
      const step1 = await handleInitInteractive(ctx, '');
      expect(postFn).toHaveBeenCalledTimes(1);
      expect(postFn.mock.calls[0][2]).toContain('Set up this topic');
      expect(postFn.mock.calls[0][3]).toBeDefined(); // keyboard
      expect(step1.text).toContain('pick a type');
      expect(step1.inlineKeyboard).toBeUndefined();

      // Step 2: name confirmation — postFn receives HTML confirm + keyboard
      const step2 = await handleInitTypeSelect(ctx, 'coding');
      expect(postFn).toHaveBeenCalledTimes(2);
      expect(postFn.mock.calls[1][2]).toContain('Got it');
      expect(postFn.mock.calls[1][2]).toContain('PostFn Project');
      expect(postFn.mock.calls[1][3]).toBeDefined(); // keyboard
      expect(step2.text).toContain('Type selected: coding');
      expect(step2.inlineKeyboard).toBeUndefined();

      // Step 3: confirm — postFn receives HTML topic card, no keyboard
      const step3 = await handleInitNameConfirm(ctx, 'coding');
      expect(postFn).toHaveBeenCalledTimes(3);
      expect(postFn.mock.calls[2][2]).toContain('PostFn Project');
      expect(postFn.mock.calls[2][2]).toContain('is ready!');
      expect(postFn.mock.calls[2][3]).toBeUndefined(); // no keyboard for final step
      expect(step3.text).toBe('');

      // Verify topic was actually created in registry
      const registry = readRegistry(workspaceDir);
      const entry = registry.topics['-100123:456'];
      expect(entry).toBeDefined();
      expect(entry?.name).toBe('PostFn Project');
      expect(entry?.type).toBe('coding');
      expect(entry?.status).toBe('active');

      // Verify capsule created
      const capsuleDir = path.join(workspaceDir, 'projects', 't-456');
      expect(fs.existsSync(capsuleDir)).toBe(true);
    });

    it('should handle already-registered between picker and type select', async () => {
      const ctx: CommandContext = {
        workspaceDir,
        configDir,
        userId: 'user123',
        groupId: '-100123',
        threadId: '456',
        rpc: null,
        logger: console,
        messageContext: { topicTitle: 'Race Test' },
      };

      // Step 1 succeeds
      const step1 = await handleInitInteractive(ctx, '');
      expect(step1.inlineKeyboard).toBeDefined();

      // Meanwhile topic gets registered via direct init
      await handleInit(ctx, 'race-test');

      // Step 2: type select detects already registered
      const step2 = await handleInitTypeSelect(ctx, 'coding');
      expect(step2.text).toContain('already registered');
    });
  });
});
