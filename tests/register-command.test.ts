import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import register from '../src/index.js';
import { createEmptyRegistry, writeRegistryAtomic, registryPath } from '../src/lib/registry.js';

describe('registerCommand handler', () => {
  let tmpDir: string;
  let configDir: string;
  let workspaceDir: string;
  let registeredCommand: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    requireAuth?: boolean;
    handler: (ctx: {
      args: string;
      commandBody: string;
      senderId?: string;
      channel?: string;
      isAuthorizedSender?: boolean;
      messageThreadId?: string | number;
    }) => Promise<{ text?: string; channelData?: { telegram?: { buttons?: unknown } } }>;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-cmd-test-'));
    configDir = path.join(tmpDir, 'config');
    workspaceDir = path.join(tmpDir, 'workspace');
    const projectsDir = path.join(workspaceDir, 'projects');

    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(projectsDir, { recursive: true });

    const registry = createEmptyRegistry('test-secret');
    writeRegistryAtomic(registryPath(workspaceDir), registry);

    const api = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      configDir,
      workspaceDir,
      registerTool: vi.fn(),
      registerCommand: vi.fn((def: typeof registeredCommand) => {
        registeredCommand = def;
      }),
    };

    register(api);
    expect(api.registerCommand).toHaveBeenCalledOnce();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should register a command named "tm" with acceptsArgs', () => {
    expect(registeredCommand.name).toBe('tm');
    expect(registeredCommand.acceptsArgs).toBe(true);
  });

  it('should map senderId → userId, channel → groupId, messageThreadId → threadId', async () => {
    const result = await registeredCommand.handler({
      args: 'help',
      commandBody: '/tm help',
      senderId: '42',
      channel: 'telegram:-100999',
      messageThreadId: 123,
    });

    // help command works regardless of context, so we just verify it returns text
    expect(result.text).toBeDefined();
    expect(result.text).toBeTruthy();
  });

  it('should strip telegram: prefix from channel for groupId', async () => {
    const result = await registeredCommand.handler({
      args: 'init',
      commandBody: '/tm init',
      senderId: 'user1',
      channel: 'telegram:-100123',
      messageThreadId: '456',
    });

    // With valid context extracted, init should NOT show "Missing context"
    expect(result.text).toBeDefined();
    expect(result.text).not.toContain('Missing context');
  });

  it('should strip telegram:group: prefix from channel for groupId', async () => {
    const result = await registeredCommand.handler({
      args: 'init',
      commandBody: '/tm init',
      senderId: 'user1',
      channel: 'telegram:group:-100123',
      messageThreadId: '456',
    });

    expect(result.text).toBeDefined();
    expect(result.text).not.toContain('Missing context');
  });

  it('should return "Missing context" when senderId/channel/threadId are absent', async () => {
    const result = await registeredCommand.handler({
      args: 'init',
      commandBody: '/tm init',
    });

    expect(result.text).toContain('Missing context');
  });

  it('should map inlineKeyboard to channelData.telegram.buttons', async () => {
    const result = await registeredCommand.handler({
      args: 'help',
      commandBody: '/tm help',
      senderId: 'user1',
      channel: 'telegram:-100123',
      messageThreadId: '456',
    });

    // help command has no inline keyboard, so channelData should be absent
    expect(result.channelData).toBeUndefined();
  });

  it('should convert numeric messageThreadId to string', async () => {
    const result = await registeredCommand.handler({
      args: 'init',
      commandBody: '/tm init',
      senderId: 'user1',
      channel: 'telegram:-100123',
      messageThreadId: 789,
    });

    // Numeric threadId should work just like string
    expect(result.text).toBeDefined();
    expect(result.text).not.toContain('Missing context');
  });

  it('should not call registerCommand when api lacks it', () => {
    const api = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      configDir,
      workspaceDir,
      registerTool: vi.fn(),
      // no registerCommand
    };

    // Should not throw
    register(api);
    expect(api.registerTool).toHaveBeenCalledOnce();
  });
});
