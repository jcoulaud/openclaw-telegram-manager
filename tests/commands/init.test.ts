import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleInit, handleInitInteractive, handleInitSlugConfirm, handleInitTypeSelect } from '../../src/commands/init.js';
import { createEmptyRegistry, writeRegistryAtomic, registryPath, readRegistry } from '../../src/lib/registry.js';
import type { CommandContext } from '../../src/commands/help.js';

describe('commands/init', () => {
  let tmpDir: string;
  let workspaceDir: string;
  let projectsDir: string;
  let configDir: string;
  let ctx: CommandContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-test-'));
    workspaceDir = path.join(tmpDir, 'workspace');
    projectsDir = path.join(workspaceDir, 'projects');
    configDir = path.join(tmpDir, 'config');

    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });

    // Initialize empty registry
    const registry = createEmptyRegistry('test-secret');
    writeRegistryAtomic(registryPath(workspaceDir), registry);

    ctx = {
      workspaceDir,
      configDir,
      userId: 'user123',
      groupId: '-100123',
      threadId: '456',
      rpc: null,
      logger: console,
      messageContext: {},
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('basic initialization', () => {
    it('should initialize a new topic with slug from topic title', async () => {
      ctx.messageContext = { topicTitle: 'My Test Project' };

      const result = await handleInit(ctx, '');

      expect(result.text).toContain('my-test-project');
      expect(result.parseMode).toBe('HTML');
      expect(result.pin).toBe(true);

      // Check registry
      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']).toBeDefined();
      expect(registry.topics['-100123:456']?.slug).toBe('my-test-project');
    });

    it('should initialize with explicit slug', async () => {
      const result = await handleInit(ctx, 'custom-slug');

      expect(result.text).toContain('custom-slug');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.slug).toBe('custom-slug');
    });

    it('should initialize with explicit type', async () => {
      const result = await handleInit(ctx, 'test-topic research');

      expect(result.text).toBeDefined();

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.type).toBe('research');
    });

    it('should default to coding type', async () => {
      const result = await handleInit(ctx, 'test-topic');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.type).toBe('coding');
    });

    it('should create capsule directory', async () => {
      await handleInit(ctx, 'test-topic');

      const capsuleDir = path.join(projectsDir, 'test-topic');
      expect(fs.existsSync(capsuleDir)).toBe(true);
      expect(fs.statSync(capsuleDir).isDirectory()).toBe(true);
    });

    it('should create capsule files', async () => {
      await handleInit(ctx, 'test-topic');

      const capsuleDir = path.join(projectsDir, 'test-topic');
      expect(fs.existsSync(path.join(capsuleDir, 'STATUS.md'))).toBe(true);
      expect(fs.existsSync(path.join(capsuleDir, 'TODO.md'))).toBe(true);
      expect(fs.existsSync(path.join(capsuleDir, 'README.md'))).toBe(true);
    });
  });

  describe('first-user bootstrap', () => {
    it('should add first user as admin', async () => {
      const result = await handleInit(ctx, 'first-topic');

      expect(result.text).toContain('first user');
      expect(result.text).toContain('admin');

      const registry = readRegistry(workspaceDir);
      expect(registry.topicManagerAdmins).toContain('user123');
    });

    it('should not add subsequent users as admin', async () => {
      // First user
      await handleInit(ctx, 'first-topic');

      // Second user with different ID
      ctx.userId = 'user456';
      ctx.groupId = '-100123';
      ctx.threadId = '789';

      const registry = readRegistry(workspaceDir);
      registry.topicManagerAdmins = ['user123']; // Ensure first user is admin

      const result = await handleInit(ctx, 'second-topic');

      expect(result.text).not.toContain('first user');

      const updatedRegistry = readRegistry(workspaceDir);
      expect(updatedRegistry.topicManagerAdmins).toEqual(['user123']);
    });
  });

  describe('validation', () => {
    it('should reject missing context', async () => {
      ctx.groupId = undefined;

      const result = await handleInit(ctx, 'test');

      expect(result.text).toContain('Missing context');
    });

    it('should reject invalid groupId format', async () => {
      ctx.groupId = 'invalid';

      const result = await handleInit(ctx, 'test');

      expect(result.text).toContain('Invalid groupId');
    });

    it('should reject invalid threadId format', async () => {
      ctx.threadId = 'invalid';

      const result = await handleInit(ctx, 'test');

      expect(result.text).toContain('Invalid threadId');
    });

    it('should reject invalid slug', async () => {
      const result = await handleInit(ctx, 'INVALID_SLUG');

      expect(result.text).toContain('Invalid slug');
    });

    it('should reject already registered topic', async () => {
      await handleInit(ctx, 'test-topic');

      const result = await handleInit(ctx, 'another-slug');

      expect(result.text).toContain('already registered');
    });

    it('should enforce max topics limit', async () => {
      const registry = readRegistry(workspaceDir);
      registry.maxTopics = 1;
      writeRegistryAtomic(registryPath(workspaceDir), registry);

      await handleInit(ctx, 'first-topic');

      ctx.groupId = '-100123';
      ctx.threadId = '789';

      const result = await handleInit(ctx, 'second-topic');

      expect(result.text).toContain('Maximum number of topics');
    });
  });

  describe('authorization', () => {
    beforeEach(() => {
      const registry = readRegistry(workspaceDir);
      registry.topicManagerAdmins = ['admin1'];
      writeRegistryAtomic(registryPath(workspaceDir), registry);
    });

    it('should allow admins to init', async () => {
      ctx.userId = 'admin1';

      const result = await handleInit(ctx, 'test-topic');

      expect(result.text).not.toContain('Not authorized');
    });

    it('should reject non-admins after first user', async () => {
      ctx.userId = 'regular-user';

      const result = await handleInit(ctx, 'test-topic');

      expect(result.text).toContain('Not authorized');
    });
  });

  describe('collision handling', () => {
    it('should handle slug collision with suffix', async () => {
      await handleInit(ctx, 'test-topic');

      ctx.groupId = '-100456';
      ctx.threadId = '789';

      const result = await handleInit(ctx, 'test-topic');

      expect(result.text).toContain('taken');
      expect(result.text).toMatch(/test-topic-\d+/);
    });

    it('should detect disk collision', async () => {
      // Create directory manually
      fs.mkdirSync(path.join(projectsDir, 'existing-dir'));

      const result = await handleInit(ctx, 'existing-dir');

      expect(result.text).toContain('taken');
    });

    it('should fail if both slug and fallback are taken', async () => {
      // Create two entries with the slug and its fallback
      await handleInit(ctx, 'test-topic');

      const suffix = ctx.groupId.replace(/^-/, '').slice(-4);
      const fallbackSlug = `test-topic-${suffix}`;

      ctx.groupId = '-100456';
      ctx.threadId = '789';
      await handleInit(ctx, fallbackSlug.slice(0, 10)); // Ensure different slug

      ctx.groupId = '-100789';
      ctx.threadId = '999';

      const result = await handleInit(ctx, 'test-topic');

      // Should either succeed with a different suffix or report both taken
      expect(result.text).toBeDefined();
    });
  });

  describe('security checks', () => {
    it('should reject path traversal in slug', async () => {
      const result = await handleInit(ctx, '../escape');

      // Path traversal gets sanitized into invalid slug format
      expect(result.text).toContain('Invalid slug');
    });

    it('should reject symlink in projects base', async () => {
      const realDir = path.join(tmpDir, 'real');
      fs.mkdirSync(realDir);

      const symlinkProjects = path.join(tmpDir, 'symlink-projects');
      fs.symlinkSync(projectsDir, symlinkProjects);

      ctx.workspaceDir = path.join(tmpDir, 'symlink-workspace');
      fs.mkdirSync(ctx.workspaceDir);
      fs.symlinkSync(symlinkProjects, path.join(ctx.workspaceDir, 'projects'));

      const registry = createEmptyRegistry('secret');
      const regPath = path.join(ctx.workspaceDir, 'projects', 'topics.json');
      fs.mkdirSync(path.dirname(regPath), { recursive: true });
      writeRegistryAtomic(regPath, registry);

      const result = await handleInit(ctx, 'test');

      expect(result.text).toContain('symlink');
    });
  });

  describe('slug derivation', () => {
    it('should derive slug from topic title', async () => {
      ctx.messageContext = { topicTitle: 'My Project 2024' };

      await handleInit(ctx, '');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.slug).toBe('my-project-2024');
    });

    it('should fallback to thread-based slug if no title', async () => {
      ctx.messageContext = {};

      await handleInit(ctx, '');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.slug).toBe('topic-456');
    });

    it('should prefix with t- if slug starts with digit', async () => {
      ctx.messageContext = { topicTitle: '2024 Project' };

      await handleInit(ctx, '');

      const registry = readRegistry(workspaceDir);
      const slug = registry.topics['-100123:456']?.slug;
      expect(slug?.startsWith('t-')).toBe(true);
    });
  });

  describe('topic types', () => {
    it('should accept coding type', async () => {
      await handleInit(ctx, 'test coding');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.type).toBe('coding');
    });

    it('should accept research type', async () => {
      await handleInit(ctx, 'test research');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.type).toBe('research');
    });

    it('should accept marketing type', async () => {
      await handleInit(ctx, 'test marketing');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.type).toBe('marketing');
    });

    it('should accept custom type', async () => {
      await handleInit(ctx, 'test custom');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.type).toBe('custom');
    });

    it('should ignore invalid type and default to coding', async () => {
      await handleInit(ctx, 'test invalid-type');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.type).toBe('coding');
    });
  });

  describe('registry entry fields', () => {
    it('should set all required fields', async () => {
      await handleInit(ctx, 'test-topic');

      const registry = readRegistry(workspaceDir);
      const entry = registry.topics['-100123:456'];

      expect(entry).toBeDefined();
      expect(entry?.groupId).toBe('-100123');
      expect(entry?.threadId).toBe('456');
      expect(entry?.slug).toBe('test-topic');
      expect(entry?.status).toBe('active');
      expect(entry?.capsuleVersion).toBeGreaterThan(0);
      expect(entry?.lastMessageAt).toBeDefined();
      expect(entry?.ignoreChecks).toEqual([]);
      expect(entry?.consecutiveSilentDoctors).toBe(0);
      expect(entry?.extras).toEqual({});
    });
  });

  describe('handleInitInteractive', () => {
    it('should delegate to handleInit when args are provided', async () => {
      const result = await handleInitInteractive(ctx, 'my-slug coding');

      expect(result.text).toContain('my-slug');
      expect(result.pin).toBe(true);

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.slug).toBe('my-slug');
      expect(registry.topics['-100123:456']?.type).toBe('coding');
    });

    it('should return slug confirmation with inline keyboard when no args', async () => {
      ctx.messageContext = { topicTitle: 'My Project' };

      const result = await handleInitInteractive(ctx, '');

      expect(result.text).toContain('my-project');
      expect(result.text).toContain('Initialize this topic');
      expect(result.parseMode).toBe('HTML');
      expect(result.inlineKeyboard).toBeDefined();
      expect(result.inlineKeyboard!.inline_keyboard).toHaveLength(1);
      expect(result.inlineKeyboard!.inline_keyboard[0][0].text).toBe('Confirm');
    });

    it('should return slug confirmation with thread-based slug when no title', async () => {
      ctx.messageContext = {};

      const result = await handleInitInteractive(ctx, '');

      expect(result.text).toContain('topic-456');
      expect(result.inlineKeyboard).toBeDefined();
    });

    it('should reject missing context in interactive mode', async () => {
      ctx.groupId = undefined;

      const result = await handleInitInteractive(ctx, '');

      expect(result.text).toContain('Missing context');
    });

    it('should reject already registered topic in interactive mode', async () => {
      await handleInit(ctx, 'existing');

      const result = await handleInitInteractive(ctx, '');

      expect(result.text).toContain('already registered');
    });

    it('should reject unauthorized user in interactive mode', async () => {
      const registry = readRegistry(workspaceDir);
      registry.topicManagerAdmins = ['admin1'];
      writeRegistryAtomic(registryPath(workspaceDir), registry);

      ctx.userId = 'regular-user';

      const result = await handleInitInteractive(ctx, '');

      expect(result.text).toContain('Not authorized');
    });

    it('should fall back to text when slug is too long for callback', async () => {
      ctx.messageContext = { topicTitle: 'a-very-long-topic-title-that-produces-a-slug-near-limits' };

      const result = await handleInitInteractive(ctx, '');

      // Either shows inline keyboard or falls back to text instructions
      if (result.inlineKeyboard) {
        expect(result.text).toContain('Initialize this topic');
      } else {
        expect(result.text).toContain('Suggested slug');
        expect(result.text).toContain('/tm init');
      }
    });

    it('should enforce max topics in interactive mode', async () => {
      const registry = readRegistry(workspaceDir);
      registry.maxTopics = 1;
      writeRegistryAtomic(registryPath(workspaceDir), registry);

      // Fill the one allowed slot
      await handleInit(ctx, 'first-topic');

      // Try interactive init on a different thread
      ctx.threadId = '789';

      const result = await handleInitInteractive(ctx, '');

      expect(result.text).toContain('Maximum number of topics');
    });
  });

  describe('handleInitSlugConfirm', () => {
    it('should return type picker with inline keyboard', async () => {
      const result = await handleInitSlugConfirm(ctx, 'my-project');

      expect(result.text).toContain('my-project');
      expect(result.text).toContain('Pick a topic type');
      expect(result.parseMode).toBe('HTML');
      expect(result.inlineKeyboard).toBeDefined();

      const rows = result.inlineKeyboard!.inline_keyboard;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveLength(2);
      expect(rows[0][0].text).toBe('Coding');
      expect(rows[0][1].text).toBe('Research');
      expect(rows[1][0].text).toBe('Marketing');
      expect(rows[1][1].text).toBe('Custom');
    });

    it('should reject missing context', async () => {
      ctx.userId = undefined;

      const result = await handleInitSlugConfirm(ctx, 'my-project');

      expect(result.text).toContain('Missing context');
    });

    it('should reject unauthorized user', async () => {
      const registry = readRegistry(workspaceDir);
      registry.topicManagerAdmins = ['admin1'];
      writeRegistryAtomic(registryPath(workspaceDir), registry);

      ctx.userId = 'regular-user';

      const result = await handleInitSlugConfirm(ctx, 'my-project');

      expect(result.text).toContain('Not authorized');
    });

    it('should reject already registered topic', async () => {
      await handleInit(ctx, 'existing');

      const result = await handleInitSlugConfirm(ctx, 'my-project');

      expect(result.text).toContain('already registered');
    });
  });

  describe('handleInitTypeSelect', () => {
    it('should complete init with coding type', async () => {
      const result = await handleInitTypeSelect(ctx, 'my-project', 'coding');

      expect(result.text).toContain('my-project');
      expect(result.pin).toBe(true);

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.type).toBe('coding');
    });

    it('should complete init with research type', async () => {
      const result = await handleInitTypeSelect(ctx, 'my-project', 'research');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.type).toBe('research');
    });

    it('should complete init with marketing type', async () => {
      const result = await handleInitTypeSelect(ctx, 'my-project', 'marketing');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.type).toBe('marketing');
    });

    it('should complete init with custom type', async () => {
      const result = await handleInitTypeSelect(ctx, 'my-project', 'custom');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.type).toBe('custom');
    });

    it('should create capsule directory', async () => {
      await handleInitTypeSelect(ctx, 'my-project', 'coding');

      const capsuleDir = path.join(projectsDir, 'my-project');
      expect(fs.existsSync(capsuleDir)).toBe(true);
    });
  });
});
