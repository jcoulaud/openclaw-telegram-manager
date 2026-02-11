#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import * as readline from 'node:readline';

// ── Constants ──────────────────────────────────────────────────────────

const MIN_OPENCLAW_VERSION = '2026.1.0';
const INCLUDE_FILENAME = 'telegram-manager.generated.groups.json5';
const REGISTRY_FILENAME = 'topics.json';

// ── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('openclaw-telegram-manager setup');
  console.log('================================\n');

  // Step 1: Check OpenClaw version
  const version = checkOpenClawVersion();
  console.log(`[1/11] OpenClaw version: ${version}`);

  // Step 2: Locate config directory
  const configDir = locateConfigDir();
  console.log(`[2/11] Config directory: ${configDir}`);

  // Step 3: Check directory permissions
  checkDirPermissions(configDir);
  console.log('[3/11] Directory permissions checked');

  // Step 4: Install plugin
  installPlugin();
  console.log('[4/11] Plugin installation checked');

  // Step 5: Patch openclaw.json with $include reference
  patchConfig(configDir);
  console.log('[5/11] Config patched with $include reference');

  // Step 6: Create workspace directory structure
  const workspaceDir = path.join(configDir, 'workspace');
  const projectsDir = path.join(workspaceDir, 'projects');
  ensureDir(projectsDir);
  console.log(`[6/11] Workspace directory: ${projectsDir}`);

  // Step 7: Initialize empty registry
  initRegistry(projectsDir);
  console.log('[7/11] Registry initialized');

  // Step 8: Create empty generated include
  createEmptyInclude(configDir);
  console.log('[8/11] Empty include file created');

  // Step 9: Optional cron setup
  const isInteractive = process.stdin.isTTY === true;
  const setupCron = isInteractive ? await promptYesNo('Set up daily doctor cron job? [Y/n] ') : true;
  if (setupCron) {
    const groupId = isInteractive
      ? await promptInput('Enter your Telegram group ID (e.g., -1003731538650): ')
      : '';
    setupDoctorCron(configDir, groupId);
    console.log('[9/11] Doctor cron job configured');
  } else {
    console.log('[9/11] Skipped cron setup');
  }

  // Step 10: Trigger gateway restart
  triggerRestart(configDir);
  console.log('[10/11] Gateway restart triggered');

  // Step 11: Print summary
  printSummary(configDir, projectsDir);
  console.log('[11/11] Setup complete!\n');
}

// ── Step implementations ──────────────────────────────────────────────

function checkOpenClawVersion(): string {
  let version: string;
  try {
    version = execSync('openclaw --version', { encoding: 'utf-8' }).trim();
  } catch {
    console.error(
      'Error: OpenClaw not found. Please install OpenClaw (>=2026.1.0) first.',
    );
    process.exit(1);
  }

  // Extract version number (e.g., "openclaw 2026.2.0" -> "2026.2.0")
  const match = version.match(/(\d+\.\d+\.\d+)/);
  if (!match) {
    console.warn(`Warning: Could not parse OpenClaw version from "${version}". Proceeding anyway.`);
    return version;
  }

  const versionStr = match[1]!;
  if (compareVersions(versionStr, MIN_OPENCLAW_VERSION) < 0) {
    console.error(
      `Error: OpenClaw ${versionStr} found, but openclaw-telegram-manager requires >=${MIN_OPENCLAW_VERSION}. Please upgrade.`,
    );
    process.exit(1);
  }

  return versionStr;
}

function locateConfigDir(): string {
  // Check environment variable
  const envDir = process.env['OPENCLAW_CONFIG_DIR'];
  if (envDir && fs.existsSync(envDir)) {
    return path.resolve(envDir);
  }

  // Check default location
  const homeDir = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  const defaultDir = path.join(homeDir, '.openclaw');
  if (fs.existsSync(defaultDir)) {
    return defaultDir;
  }

  // Walk up from cwd looking for openclaw.json
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'openclaw.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  console.error(
    'Error: Could not find OpenClaw config directory. Set $OPENCLAW_CONFIG_DIR or ensure ~/.openclaw/ exists.',
  );
  process.exit(1);
}

function checkDirPermissions(dir: string): void {
  try {
    const stat = fs.statSync(dir);
    const mode = stat.mode;
    const permissions = (mode & 0o777).toString(8);

    // Check for world-writable or group-writable
    if (mode & 0o002) {
      console.warn(
        `Warning: ${dir} is world-writable (${permissions}). Consider restricting to owner-only (chmod 700).`,
      );
    } else if (mode & 0o020) {
      console.warn(
        `Warning: ${dir} is group-writable (${permissions}). Consider restricting to owner-only (chmod 700).`,
      );
    }
  } catch {
    console.warn(`Warning: Could not check permissions for ${dir}.`);
  }
}

function installPlugin(): void {
  try {
    // Check if already installed
    const result = execSync('openclaw plugins list', { encoding: 'utf-8' });
    if (result.includes('openclaw-telegram-manager')) {
      console.log('  Plugin already installed, skipping.');
      return;
    }
  } catch {
    // plugins list might not be available, try installing anyway
  }

  try {
    execSync('openclaw plugins install openclaw-telegram-manager', {
      encoding: 'utf-8',
      stdio: 'inherit',
    });
  } catch {
    console.warn(
      '  Warning: Could not install plugin via `openclaw plugins install`. You may need to install manually.',
    );
  }
}

function patchConfig(configDir: string): void {
  const configPath = path.join(configDir, 'openclaw.json');

  if (!fs.existsSync(configPath)) {
    console.warn(`  Warning: ${configPath} not found. Skipping config patch.`);
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    console.warn(`  Warning: Could not read ${configPath}. Skipping config patch.`);
    return;
  }

  // Check if $include reference already exists
  if (content.includes(INCLUDE_FILENAME)) {
    console.log('  $include reference already present, skipping.');
    return;
  }

  // Parse as JSON (OpenClaw config may be JSON or JSON5)
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    // Try a more lenient approach: just check for the string and warn
    console.warn(
      '  Warning: Could not parse openclaw.json as JSON. Please manually add the $include reference.',
    );
    console.warn(`  Add to channels.telegram.groups: { "$include": "./${INCLUDE_FILENAME}" }`);
    return;
  }

  // Ensure path exists: channels.telegram.groups
  if (!config['channels']) config['channels'] = {};
  const channels = config['channels'] as Record<string, unknown>;

  if (!channels['telegram']) channels['telegram'] = {};
  const telegram = channels['telegram'] as Record<string, unknown>;

  // Set groups to $include
  telegram['groups'] = { $include: `./${INCLUDE_FILENAME}` };

  // Backup and write
  const bakPath = configPath + '.bak';
  fs.copyFileSync(configPath, bakPath);

  const newContent = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(configPath, newContent, { mode: 0o600 });
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function initRegistry(projectsDir: string): void {
  const registryPath = path.join(projectsDir, REGISTRY_FILENAME);

  if (fs.existsSync(registryPath)) {
    console.log('  Registry already exists, skipping initialization.');
    return;
  }

  const callbackSecret = crypto.randomBytes(32).toString('hex');
  const registry = {
    version: 1,
    topicManagerAdmins: [],
    callbackSecret,
    lastDoctorAllRunAt: null,
    maxTopics: 100,
    topics: {},
  };

  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', {
    mode: 0o600,
  });
}

function createEmptyInclude(configDir: string): void {
  const includePath = path.join(configDir, INCLUDE_FILENAME);

  if (fs.existsSync(includePath)) {
    console.log('  Include file already exists, skipping.');
    return;
  }

  const content = [
    '// This file is generated by telegram-manager. Do not hand-edit.',
    '{}',
    '',
  ].join('\n');

  fs.writeFileSync(includePath, content, { mode: 0o600 });
}

function setupDoctorCron(configDir: string, groupId: string): void {
  const cronDir = path.join(configDir, 'cron');
  ensureDir(cronDir);

  const cronJobPath = path.join(cronDir, 'topic-doctor-daily.json');

  if (fs.existsSync(cronJobPath)) {
    console.log('  Cron job already exists, skipping.');
    return;
  }

  const target = groupId
    ? `${groupId}:topic:1`
    : '-100XXXXXXXXXX:topic:1';

  const cronJob = {
    name: 'topic-doctor-daily',
    schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'UTC' },
    sessionTarget: 'isolated',
    payload: {
      kind: 'agentTurn',
      message:
        'Run topic doctor health checks on all registered topics. Check the registry at projects/topics.json and evaluate each eligible topic. Post per-topic reports with inline keyboards. If any topic\'s thread returns an API error (deleted/migrated), log it and continue to the next topic.',
      timeoutSeconds: 300,
    },
    delivery: {
      mode: 'announce',
      channel: 'telegram',
      to: target,
      bestEffort: true,
    },
    enabled: true,
    deleteAfterRun: false,
  };

  fs.writeFileSync(cronJobPath, JSON.stringify(cronJob, null, 2) + '\n', {
    mode: 0o600,
  });

  if (!groupId) {
    console.warn(
      '  Warning: No group ID provided. Edit the cron job at:',
    );
    console.warn(`  ${cronJobPath}`);
    console.warn('  Replace -100XXXXXXXXXX with your actual group ID.');
  }
}

function triggerRestart(configDir: string): void {
  try {
    execSync('openclaw gateway restart', {
      encoding: 'utf-8',
      timeout: 10_000,
    });
  } catch {
    console.warn(
      '  Warning: Could not restart gateway. Run `openclaw gateway restart` manually.',
    );
  }
}

function printSummary(configDir: string, projectsDir: string): void {
  console.log('\n================================');
  console.log('Setup complete!\n');
  console.log('What was done:');
  console.log(`  - Config directory: ${configDir}`);
  console.log(`  - Projects directory: ${projectsDir}`);
  console.log(`  - Registry: ${path.join(projectsDir, REGISTRY_FILENAME)}`);
  console.log(`  - Include: ${path.join(configDir, INCLUDE_FILENAME)}`);
  console.log('\nNext steps:');
  console.log('  1. Go to any Telegram forum topic');
  console.log('  2. Type /topic init');
  console.log('  3. The topic will be registered and a capsule created');
  console.log('\nFor help: /topic help');
}

// ── Helpers ───────────────────────────────────────────────────────────

function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] ?? 0;
    const bVal = bParts[i] ?? 0;
    if (aVal !== bVal) return aVal - bVal;
  }
  return 0;
}

function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === '' || normalized === 'y' || normalized === 'yes');
    });
  });
}

function promptInput(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Entry point ───────────────────────────────────────────────────────

main().catch((err) => {
  console.error('Setup failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
