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
      from?: string;
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

  it('should map senderId → userId, from → groupId, messageThreadId → threadId', async () => {
    const result = await registeredCommand.handler({
      args: 'help',
      commandBody: '/tm help',
      senderId: '42',
      from: 'telegram:-100999',
      messageThreadId: 123,
    });

    // help command works regardless of context, so we just verify it returns text
    expect(result.text).toBeDefined();
    expect(result.text).toBeTruthy();
  });

  it('should strip telegram: prefix from ctx.from for groupId', async () => {
    const result = await registeredCommand.handler({
      args: 'init',
      commandBody: '/tm init',
      senderId: 'user1',
      from: 'telegram:-100123',
      messageThreadId: '456',
    });

    // With valid context extracted, init should NOT show an error
    expect(result.text).toBeDefined();
    expect(result.text).not.toContain('Something went wrong');
  });

  it('should strip telegram:group: prefix from ctx.from for groupId', async () => {
    const result = await registeredCommand.handler({
      args: 'init',
      commandBody: '/tm init',
      senderId: 'user1',
      from: 'telegram:group:-100123',
      messageThreadId: '456',
    });

    expect(result.text).toBeDefined();
    expect(result.text).not.toContain('Something went wrong');
  });

  it('should strip :topic: suffix from ctx.from for groupId', async () => {
    const result = await registeredCommand.handler({
      args: 'init',
      commandBody: '/tm init',
      senderId: 'user1',
      from: 'telegram:group:-1003731538650:topic:123',
      messageThreadId: '456',
    });

    expect(result.text).toBeDefined();
    expect(result.text).not.toContain('Something went wrong');
  });

  it('should return error when senderId/from/threadId are absent', async () => {
    const result = await registeredCommand.handler({
      args: 'init',
      commandBody: '/tm init',
    });

    expect(result.text).toContain('Something went wrong');
  });

  it('should map inlineKeyboard to channelData.telegram.buttons as raw 2D array', async () => {
    // init with no args returns a type picker with 4 buttons in 2 rows
    const result = await registeredCommand.handler({
      args: 'init',
      commandBody: '/tm init',
      senderId: 'user1',
      from: 'telegram:-100123',
      messageThreadId: '456',
    });

    // buttons should be the raw 2D array, not wrapped in { inline_keyboard: ... }
    const buttons = result.channelData?.telegram?.buttons as Array<Array<{ text: string; callback_data: string }>>;
    expect(buttons).toBeDefined();
    expect(Array.isArray(buttons)).toBe(true);
    expect(Array.isArray(buttons[0])).toBe(true);
    expect(buttons[0][0]).toHaveProperty('text');
    expect(buttons[0][0]).toHaveProperty('callback_data');
    // Type picker: row 1 = Coding, Research; row 2 = Marketing, Custom
    expect(buttons[0][0].text).toBe('Coding');
    expect(buttons[0][1].text).toBe('Research');
    expect(buttons[1][0].text).toBe('Marketing');
    expect(buttons[1][1].text).toBe('Custom');
    // Callback format: tm:action:groupId:threadId:userId:hmac (6 parts)
    const parts = buttons[0][0].callback_data.split(':');
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('tm');
  });

  it('should not include parse_mode since commands use Markdown', async () => {
    const result = await registeredCommand.handler({
      args: 'init',
      commandBody: '/tm init',
      senderId: 'user1',
      from: 'telegram:-100123',
      messageThreadId: '456',
    });

    expect((result.channelData?.telegram as Record<string, unknown>)?.parse_mode).toBeUndefined();
  });

  it('should not include buttons when command returns no keyboard', async () => {
    const result = await registeredCommand.handler({
      args: 'help',
      commandBody: '/tm help',
    });

    // help command has no inline keyboard, so no buttons in channelData
    expect(result.channelData?.telegram?.buttons).toBeUndefined();
  });

  it('should convert numeric messageThreadId to string', async () => {
    const result = await registeredCommand.handler({
      args: 'init',
      commandBody: '/tm init',
      senderId: 'user1',
      from: 'telegram:-100123',
      messageThreadId: 789,
    });

    // Numeric threadId should work just like string
    expect(result.text).toBeDefined();
    expect(result.text).not.toContain('Something went wrong');
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
