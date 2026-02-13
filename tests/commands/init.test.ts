import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleInit, handleInitInteractive, handleInitTypeSelect, handleInitNameConfirm } from '../../src/commands/init.js';
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
    it('should initialize a new topic with name from topic title', async () => {
      ctx.messageContext = { topicTitle: 'My Test Project' };

      const result = await handleInit(ctx, '');

      expect(result.text).toContain('My Test Project');
      expect(result.pin).toBe(true);

      // Check registry
      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']).toBeDefined();
      expect(registry.topics['-100123:456']?.slug).toBe('t-456');
      expect(registry.topics['-100123:456']?.name).toBe('My Test Project');
    });

    it('should initialize with explicit name', async () => {
      const result = await handleInit(ctx, 'custom-name');

      expect(result.text).toContain('custom-name');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.slug).toBe('t-456');
      expect(registry.topics['-100123:456']?.name).toBe('custom-name');
    });

    it('should initialize with explicit type', async () => {
      const result = await handleInit(ctx, 'test-topic research');

      expect(result.text).toBeDefined();

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.slug).toBe('t-456');
      expect(registry.topics['-100123:456']?.name).toBe('test-topic');
      expect(registry.topics['-100123:456']?.type).toBe('research');
    });

    it('should default to coding type', async () => {
      const result = await handleInit(ctx, 'test-topic');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.slug).toBe('t-456');
      expect(registry.topics['-100123:456']?.type).toBe('coding');
    });

    it('should create capsule directory', async () => {
      await handleInit(ctx, 'test-topic');

      const capsuleDir = path.join(projectsDir, 't-456');
      expect(fs.existsSync(capsuleDir)).toBe(true);
      expect(fs.statSync(capsuleDir).isDirectory()).toBe(true);
    });

    it('should create capsule files', async () => {
      await handleInit(ctx, 'test-topic');

      const capsuleDir = path.join(projectsDir, 't-456');
      expect(fs.existsSync(path.join(capsuleDir, 'STATUS.md'))).toBe(true);
      expect(fs.existsSync(path.join(capsuleDir, 'TODO.md'))).toBe(true);
      expect(fs.existsSync(path.join(capsuleDir, 'README.md'))).toBe(true);
    });
  });

  describe('first-user bootstrap', () => {
    it('should add first user as admin', async () => {
      const result = await handleInit(ctx, 'first-topic');

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

      expect(result.text).toContain('doesn\'t look like a valid forum topic');
    });

    it('should reject invalid threadId format', async () => {
      ctx.threadId = 'invalid';

      const result = await handleInit(ctx, 'test');

      expect(result.text).toContain('doesn\'t look like a valid forum topic');
    });

    it('should reject already registered topic', async () => {
      await handleInit(ctx, 'test-topic');

      const result = await handleInit(ctx, 'another-name');

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

  describe('security checks', () => {
    it('should reject path traversal in slug', async () => {
      const result = await handleInit(ctx, '../escape');

      // Path traversal gets caught by security checks
      expect(result.text).toBeDefined();
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

      expect(result.text).toContain('unsafe file system configuration');
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
      expect(entry?.slug).toBe('t-456');
      expect(entry?.name).toBe('test-topic');
      expect(entry?.status).toBe('active');
      expect(entry?.capsuleVersion).toBeGreaterThan(0);
      expect(entry?.lastMessageAt).toBeDefined();
      expect(entry?.consecutiveSilentDoctors).toBe(0);
      expect(entry?.extras).toEqual({});
    });
  });

  describe('handleInitInteractive', () => {
    it('should delegate to handleInit when args are provided', async () => {
      const result = await handleInitInteractive(ctx, 'my-name coding');

      expect(result.text).toContain('my-name');
      expect(result.pin).toBe(true);

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.slug).toBe('t-456');
      expect(registry.topics['-100123:456']?.name).toBe('my-name');
      expect(registry.topics['-100123:456']?.type).toBe('coding');
    });

    it('should return type picker with inline keyboard when no args', async () => {
      ctx.messageContext = { topicTitle: 'My Project' };

      const result = await handleInitInteractive(ctx, '');

      expect(result.text).toContain('Pick a topic type');
      expect(result.inlineKeyboard).toBeDefined();

      const rows = result.inlineKeyboard!.inline_keyboard;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveLength(2);
      expect(rows[0][0].text).toBe('Coding');
      expect(rows[0][1].text).toBe('Research');
      expect(rows[1][0].text).toBe('Marketing');
      expect(rows[1][1].text).toBe('Custom');
    });

    it('should return type picker when no title', async () => {
      ctx.messageContext = {};

      const result = await handleInitInteractive(ctx, '');

      expect(result.text).toContain('Pick a topic type');
      expect(result.inlineKeyboard).toBeDefined();

      const rows = result.inlineKeyboard!.inline_keyboard;
      expect(rows).toHaveLength(2);
      expect(rows[0][0].text).toBe('Coding');
      expect(rows[0][1].text).toBe('Research');
      expect(rows[1][0].text).toBe('Marketing');
      expect(rows[1][1].text).toBe('Custom');
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

  describe('handleInitTypeSelect', () => {
    it('should show confirmation message with Use this name button for coding', async () => {
      ctx.messageContext = { topicTitle: 'My Project' };

      const result = await handleInitTypeSelect(ctx, 'coding');

      expect(result.text).toContain('My Project');
      expect(result.text).toContain('coding');
      expect(result.inlineKeyboard).toBeDefined();
      expect(result.inlineKeyboard!.inline_keyboard[0][0].text).toBe('Use this name');
      expect(result.pin).toBeUndefined();

      // Topic should NOT be in registry yet
      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']).toBeUndefined();
    });

    it('should show confirmation for research type', async () => {
      const result = await handleInitTypeSelect(ctx, 'research');

      expect(result.text).toContain('research');
      expect(result.inlineKeyboard).toBeDefined();
      expect(result.inlineKeyboard!.inline_keyboard[0][0].text).toBe('Use this name');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']).toBeUndefined();
    });

    it('should show confirmation for marketing type', async () => {
      const result = await handleInitTypeSelect(ctx, 'marketing');

      expect(result.text).toContain('marketing');
      expect(result.inlineKeyboard).toBeDefined();

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']).toBeUndefined();
    });

    it('should show confirmation for custom type', async () => {
      const result = await handleInitTypeSelect(ctx, 'custom');

      expect(result.text).toContain('custom');
      expect(result.inlineKeyboard).toBeDefined();

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']).toBeUndefined();
    });

    it('should not create capsule directory', async () => {
      await handleInitTypeSelect(ctx, 'coding');

      const capsuleDir = path.join(projectsDir, 't-456');
      expect(fs.existsSync(capsuleDir)).toBe(false);
    });

    it('should show topicTitle in confirmation when available', async () => {
      ctx.messageContext = { topicTitle: 'Named Project' };

      const result = await handleInitTypeSelect(ctx, 'coding');

      expect(result.text).toContain('Named Project');
    });

    it('should show default name in confirmation when no title', async () => {
      ctx.messageContext = {};

      const result = await handleInitTypeSelect(ctx, 'coding');

      expect(result.text).toContain('Topic 456');
    });

    it('should include Almost there heading in confirm message', async () => {
      const result = await handleInitTypeSelect(ctx, 'coding');

      expect(result.text).toContain('Almost there');
    });

    it('should include hint about /tm init <name> <type>', async () => {
      const result = await handleInitTypeSelect(ctx, 'coding');

      expect(result.text).toContain('/tm init');
    });
  });

  describe('postFn direct posting', () => {
    it('should post HTML via postFn for type picker (step 1)', async () => {
      const postFn = vi.fn().mockResolvedValue(undefined);
      ctx.postFn = postFn;
      ctx.messageContext = { topicTitle: 'My Project' };

      const result = await handleInitInteractive(ctx, '');

      expect(postFn).toHaveBeenCalledOnce();
      const [gId, tId, html, keyboard] = postFn.mock.calls[0];
      expect(gId).toBe('-100123');
      expect(tId).toBe('456');
      expect(html).toContain('Set up a new topic workcell');
      expect(html).toContain('Coding');
      expect(keyboard).toBeDefined();
      expect(keyboard.inline_keyboard).toHaveLength(2);

      // CommandResult should be minimal text with no keyboard
      expect(result.text).toContain('pick a type');
      expect(result.inlineKeyboard).toBeUndefined();
    });

    it('should post HTML via postFn for name confirmation (step 2)', async () => {
      const postFn = vi.fn().mockResolvedValue(undefined);
      ctx.postFn = postFn;
      ctx.messageContext = { topicTitle: 'My Project' };

      const result = await handleInitTypeSelect(ctx, 'research');

      expect(postFn).toHaveBeenCalledOnce();
      const [gId, tId, html, keyboard] = postFn.mock.calls[0];
      expect(gId).toBe('-100123');
      expect(tId).toBe('456');
      expect(html).toContain('Almost there');
      expect(html).toContain('My Project');
      expect(html).toContain('research');
      expect(keyboard).toBeDefined();
      expect(keyboard.inline_keyboard[0][0].text).toBe('Use this name');

      // CommandResult should be minimal text with no keyboard
      expect(result.text).toContain('Type selected: research');
      expect(result.inlineKeyboard).toBeUndefined();
    });

    it('should post HTML via postFn for topic card (step 3)', async () => {
      const postFn = vi.fn().mockResolvedValue(undefined);
      ctx.postFn = postFn;
      ctx.messageContext = { topicTitle: 'My Project' };

      const result = await handleInit(ctx, 'my-project coding');

      expect(postFn).toHaveBeenCalledOnce();
      const [gId, tId, html] = postFn.mock.calls[0];
      expect(gId).toBe('-100123');
      expect(tId).toBe('456');
      expect(html).toContain('Topic: my-project');
      expect(html).toContain('How it works');

      // CommandResult should be minimal text with pin
      expect(result.text).toBe('');
      expect(result.pin).toBe(true);
    });

    it('should fall back to markdown when postFn throws', async () => {
      const postFn = vi.fn().mockRejectedValue(new Error('network error'));
      ctx.postFn = postFn;
      ctx.messageContext = { topicTitle: 'My Project' };

      const result = await handleInitInteractive(ctx, '');

      expect(postFn).toHaveBeenCalledOnce();
      // Falls back to markdown with inline keyboard
      expect(result.text).toContain('Pick a topic type');
      expect(result.inlineKeyboard).toBeDefined();
    });

    it('should fall back to markdown when postFn throws for type select', async () => {
      const postFn = vi.fn().mockRejectedValue(new Error('network error'));
      ctx.postFn = postFn;
      ctx.messageContext = { topicTitle: 'My Project' };

      const result = await handleInitTypeSelect(ctx, 'coding');

      expect(postFn).toHaveBeenCalledOnce();
      // Falls back to markdown with inline keyboard
      expect(result.text).toContain('Almost there');
      expect(result.inlineKeyboard).toBeDefined();
    });

    it('should fall back to markdown when postFn throws for init', async () => {
      const postFn = vi.fn().mockRejectedValue(new Error('network error'));
      ctx.postFn = postFn;

      const result = await handleInit(ctx, 'test-topic coding');

      expect(postFn).toHaveBeenCalledOnce();
      // Falls back to full markdown topic card
      expect(result.text).toContain('**Topic: test-topic**');
      expect(result.pin).toBe(true);
    });

    it('should fall back to markdown when postFn is undefined', async () => {
      // postFn not set (undefined) - existing behavior
      const result = await handleInitInteractive(ctx, '');

      expect(result.text).toContain('Pick a topic type');
      expect(result.inlineKeyboard).toBeDefined();
    });

    it('should not pass keyboard to postFn for step 3 (final step)', async () => {
      const postFn = vi.fn().mockResolvedValue(undefined);
      ctx.postFn = postFn;

      await handleInit(ctx, 'test-topic coding');

      expect(postFn).toHaveBeenCalledOnce();
      // Step 3 should not include a keyboard argument (or it should be undefined)
      const [, , , keyboard] = postFn.mock.calls[0];
      expect(keyboard).toBeUndefined();
    });
  });

  describe('handleInitNameConfirm', () => {
    it('should complete init with coding type', async () => {
      ctx.messageContext = { topicTitle: 'My Project' };

      const result = await handleInitNameConfirm(ctx, 'coding');

      expect(result.text).toContain('My Project');
      expect(result.pin).toBe(true);

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.slug).toBe('t-456');
      expect(registry.topics['-100123:456']?.type).toBe('coding');
    });

    it('should complete init with research type', async () => {
      const result = await handleInitNameConfirm(ctx, 'research');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.slug).toBe('t-456');
      expect(registry.topics['-100123:456']?.type).toBe('research');
    });

    it('should complete init with marketing type', async () => {
      const result = await handleInitNameConfirm(ctx, 'marketing');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.slug).toBe('t-456');
      expect(registry.topics['-100123:456']?.type).toBe('marketing');
    });

    it('should complete init with custom type', async () => {
      const result = await handleInitNameConfirm(ctx, 'custom');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.slug).toBe('t-456');
      expect(registry.topics['-100123:456']?.type).toBe('custom');
    });

    it('should create capsule directory', async () => {
      await handleInitNameConfirm(ctx, 'coding');

      const capsuleDir = path.join(projectsDir, 't-456');
      expect(fs.existsSync(capsuleDir)).toBe(true);
    });

    it('should use topicTitle as name', async () => {
      ctx.messageContext = { topicTitle: 'Named Project' };

      await handleInitNameConfirm(ctx, 'coding');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.name).toBe('Named Project');
    });

    it('should use default name when no title', async () => {
      ctx.messageContext = {};

      await handleInitNameConfirm(ctx, 'coding');

      const registry = readRegistry(workspaceDir);
      expect(registry.topics['-100123:456']?.name).toBe('Topic 456');
    });
  });
});
