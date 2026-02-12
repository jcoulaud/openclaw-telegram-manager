import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleAutopilot } from '../../src/commands/autopilot.js';
import { createEmptyRegistry, writeRegistryAtomic, registryPath, readRegistry } from '../../src/lib/registry.js';
import type { CommandContext } from '../../src/lib/types.js';

describe('autopilot', () => {
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

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-test-'));
    workspaceDir = path.join(tmpDir, 'workspace');
    configDir = path.join(tmpDir, 'config');
    const projectsDir = path.join(workspaceDir, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });

    const registry = createEmptyRegistry('secret');
    registry.topicManagerAdmins = ['admin1'];
    writeRegistryAtomic(registryPath(workspaceDir), registry);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('enable', () => {
    it('should create HEARTBEAT.md with markers and deterministic instructions', async () => {
      const result = await handleAutopilot(makeCtx(), '');
      expect(result.text).toContain('Autopilot enabled');

      const heartbeatPath = path.join(workspaceDir, 'HEARTBEAT.md');
      expect(fs.existsSync(heartbeatPath)).toBe(true);

      const content = fs.readFileSync(heartbeatPath, 'utf-8');
      expect(content).toContain('<!-- TM_AUTOPILOT_START -->');
      expect(content).toContain('<!-- TM_AUTOPILOT_END -->');
      expect(content).toContain('doctor --all');
      expect(content).toContain('Balanced Autopilot');
      expect(content).toContain('Last done (UTC)');
      expect(content).toContain('CALL');
      expect(content).toContain('IN ORDER');
      expect(content).toContain('HEARTBEAT_OK');
    });

    it('should set registry autopilotEnabled to true', async () => {
      await handleAutopilot(makeCtx(), 'enable');

      const reg = readRegistry(workspaceDir);
      expect(reg.autopilotEnabled).toBe(true);
    });

    it('should be idempotent — does not duplicate section', async () => {
      await handleAutopilot(makeCtx(), 'enable');
      const result = await handleAutopilot(makeCtx(), 'enable');

      expect(result.text).toContain('already enabled');

      const content = fs.readFileSync(path.join(workspaceDir, 'HEARTBEAT.md'), 'utf-8');
      const startCount = (content.match(/TM_AUTOPILOT_START/g) ?? []).length;
      expect(startCount).toBe(1);
    });

    it('should preserve existing HEARTBEAT.md content', async () => {
      const heartbeatPath = path.join(workspaceDir, 'HEARTBEAT.md');
      fs.writeFileSync(heartbeatPath, '## Other Tasks\n- [ ] Something else\n');

      await handleAutopilot(makeCtx(), 'enable');

      const content = fs.readFileSync(heartbeatPath, 'utf-8');
      expect(content).toContain('Other Tasks');
      expect(content).toContain('TM_AUTOPILOT_START');
    });
  });

  describe('disable', () => {
    it('should remove marker block and set flag to false', async () => {
      await handleAutopilot(makeCtx(), 'enable');
      const result = await handleAutopilot(makeCtx(), 'disable');

      expect(result.text).toContain('Autopilot disabled');

      const reg = readRegistry(workspaceDir);
      expect(reg.autopilotEnabled).toBe(false);
    });

    it('should preserve unrelated HEARTBEAT.md content', async () => {
      const heartbeatPath = path.join(workspaceDir, 'HEARTBEAT.md');
      fs.writeFileSync(heartbeatPath, '## Other Tasks\n- [ ] Something else\n');

      await handleAutopilot(makeCtx(), 'enable');
      await handleAutopilot(makeCtx(), 'disable');

      const content = fs.readFileSync(heartbeatPath, 'utf-8');
      expect(content).toContain('Other Tasks');
      expect(content).not.toContain('TM_AUTOPILOT_START');
    });

    it('should handle disable when not enabled', async () => {
      const result = await handleAutopilot(makeCtx(), 'disable');
      expect(result.text).toContain('not enabled');
    });

    it('should handle disable when HEARTBEAT.md has no markers', async () => {
      const heartbeatPath = path.join(workspaceDir, 'HEARTBEAT.md');
      fs.writeFileSync(heartbeatPath, '## Other content\n');

      const result = await handleAutopilot(makeCtx(), 'disable');
      expect(result.text).toContain('not enabled');
    });
  });

  describe('status', () => {
    it('should show disabled state', async () => {
      const result = await handleAutopilot(makeCtx(), 'status');
      expect(result.text).toContain('disabled');
      expect(result.text).toContain('never');
    });

    it('should show enabled state and last run time', async () => {
      await handleAutopilot(makeCtx(), 'enable');

      const result = await handleAutopilot(makeCtx(), 'status');
      expect(result.text).toContain('enabled');
    });
  });

  describe('auth', () => {
    it('should reject non-admin users', async () => {
      const result = await handleAutopilot(makeCtx({ userId: 'non-admin' }), 'enable');
      expect(result.text).toContain('Not authorized');
    });

    it('should reject when userId missing', async () => {
      const result = await handleAutopilot(makeCtx({ userId: undefined }), 'enable');
      expect(result.text).toContain('Missing context');
    });
  });

  describe('unknown sub-command', () => {
    it('should return error for unknown sub-command', async () => {
      const result = await handleAutopilot(makeCtx(), 'foobar');
      expect(result.text).toContain('Unknown autopilot sub-command');
    });
  });
});
