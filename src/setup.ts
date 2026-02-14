#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import * as readline from 'node:readline';
import JSON5 from 'json5';

// ── Constants ──────────────────────────────────────────────────────────

const PLUGIN_NAME = 'openclaw-telegram-manager';
const PLUGIN_DISPLAY_NAME = 'OpenClaw Telegram Manager';
const PLUGIN_VERSION: string = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
).version;
const MIN_OPENCLAW_VERSION = '2026.1.0';
const INCLUDE_FILENAME = 'telegram-manager.generated.groups.json5';
const REGISTRY_FILENAME = 'topics.json';
const PLUGIN_FILES = ['openclaw.plugin.json', 'dist/plugin.js', 'skills', 'package.json'];
const REQUIRED_PLUGIN_FILES = ['openclaw.plugin.json', 'dist/plugin.js'];
// Stable tag embedded in the instruction — never changes, even if wording does.
// Used to identify and replace our line idempotently.
const FLUSH_TAG = '[tm]';
// Content fingerprints unique to our instruction. The AI may reword the line
// and drop the tag, so we also match on keywords that only appear in our instruction.
const FLUSH_FINGERPRINTS = [FLUSH_TAG, 'STATUS.md'];
// Keep in sync with CURRENT_REGISTRY_VERSION in src/lib/types.ts
const SETUP_REGISTRY_VERSION = 7;
const MEMORY_FLUSH_INSTRUCTION =
  `If you are working on a Telegram topic folder (projects/<slug>/), update its STATUS.md with current "Last done (UTC)" and "Next actions (now)" before this context is compacted. ${FLUSH_TAG}`;

// Keep in sync with HEARTBEAT_BLOCK in src/commands/autopilot.ts
const SETUP_MARKER_START = '<!-- TM_AUTOPILOT_START -->';
const SETUP_MARKER_END = '<!-- TM_AUTOPILOT_END -->';
const SETUP_HEARTBEAT_BLOCK = `${SETUP_MARKER_START}
## Topic Manager — Balanced Autopilot

Daily reports and health checks are handled by the cron scheduler.
No action needed here (HEARTBEAT_OK).
${SETUP_MARKER_END}`;

// ── Colors (zero dependencies, respects NO_COLOR / non-TTY) ──────────

const useColor =
  process.stdout.isTTY === true &&
  !process.env['NO_COLOR'] &&
  process.env['TERM'] !== 'dumb';

const c = {
  reset:   useColor ? '\x1b[0m'  : '',
  bold:    useColor ? '\x1b[1m'  : '',
  dim:     useColor ? '\x1b[2m'  : '',
  green:   useColor ? '\x1b[32m' : '',
  yellow:  useColor ? '\x1b[33m' : '',
  red:     useColor ? '\x1b[31m' : '',
  cyan:    useColor ? '\x1b[36m' : '',
  magenta: useColor ? '\x1b[35m' : '',
};

// ── Spinner (zero dependencies, TTY-only) ────────────────────────────

let spinnerTimer: ReturnType<typeof setInterval> | null = null;

function startSpinner(msg: string): void {
  stopSpinner();
  if (!process.stdout.isTTY) return;
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const render = () => {
    process.stdout.write(`\r  ${c.cyan}${frames[i++ % frames.length]}${c.reset}  ${msg}`);
  };
  render();
  spinnerTimer = setInterval(render, 80);
}

function stopSpinner(): void {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
    process.stdout.write('\r\x1b[2K');
  }
}

// ── Logging helpers ───────────────────────────────────────────────────

function ok(msg: string): void {
  stopSpinner();
  console.log(`  ${c.green}✓${c.reset}  ${msg}`);
}
function warn(msg: string): void {
  stopSpinner();
  console.warn(`  ${c.yellow}⚠${c.reset}  ${c.yellow}${msg}${c.reset}`);
}
function fail(msg: string): void {
  stopSpinner();
  console.error(`  ${c.red}✗${c.reset}  ${c.red}${msg}${c.reset}`);
}
function info(msg: string): void {
  console.log(`     ${c.dim}${msg}${c.reset}`);
}

function banner(title: string, subtitle?: string): void {
  console.log('');
  console.log(`  ${c.cyan}◆${c.reset}  ${c.bold}${title}${c.reset}${subtitle ? `  ${c.dim}${subtitle}${c.reset}` : ''}`);
  console.log(`  ${c.dim}│${c.reset}`);
}

function footer(msg: string): void {
  console.log(`  ${c.dim}│${c.reset}`);
  console.log(`  ${c.green}◆${c.reset}  ${c.bold}${msg}${c.reset}`);
  console.log('');
}

function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  ${c.yellow}?${c.reset}  ${question} ${c.dim}[y/N]${c.reset} `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ── Setup ─────────────────────────────────────────────────────────────

async function runSetup(): Promise<void> {
  banner(PLUGIN_DISPLAY_NAME, `v${PLUGIN_VERSION}`);

  startSpinner('Checking OpenClaw version…');
  const version = checkOpenClawVersion();
  ok(`OpenClaw ${c.dim}${version}${c.reset}`);

  startSpinner('Locating config…');
  const configDir = locateConfigDir();
  checkDirPermissions(configDir);
  ok(`Config ${c.dim}${configDir}${c.reset}`);

  startSpinner('Installing plugin…');
  installPlugin(configDir);

  startSpinner('Patching config…');
  const existingGroups = patchConfig(configDir);

  startSpinner('Patching memory flush…');
  patchMemoryFlush(configDir);

  startSpinner('Preparing workspace…');
  const workspaceDir = path.join(configDir, 'workspace');
  const projectsDir = path.join(workspaceDir, 'projects');
  ensureDir(projectsDir);
  ensureGitignore(workspaceDir);
  initRegistry(projectsDir);
  createEmptyInclude(configDir, existingGroups);
  ok('Workspace ready');

  startSpinner('Enabling autopilot…');
  writeHeartbeat(configDir);
  ok('Autopilot enabled');

  startSpinner('Restarting gateway…');
  if (triggerRestart()) ok('Gateway restarted');

  footer('Setup complete');

  console.log(`  ${c.dim}Next steps:${c.reset}`);
  console.log(`  ${c.dim}1.${c.reset} Open any Telegram forum topic`);
  console.log(`  ${c.dim}2.${c.reset} Type ${c.cyan}/tm init${c.reset}`);
  console.log(`  ${c.dim}3.${c.reset} The topic will be set up with persistent memory`);
  console.log('');
  console.log(`  ${c.dim}Autopilot is active — health checks and daily reports run automatically.${c.reset}`);
  console.log(`  ${c.dim}To disable: ${c.reset}${c.cyan}/tm autopilot disable${c.reset}`);
  console.log('');
}

// ── Uninstall ─────────────────────────────────────────────────────────

async function runUninstall(): Promise<void> {
  banner(PLUGIN_DISPLAY_NAME, 'uninstall');

  startSpinner('Locating config…');
  const configDir = locateConfigDir();
  ok(`Config ${c.dim}${configDir}${c.reset}`);

  startSpinner('Removing plugin…');
  removePluginDir(configDir);
  unpatchConfig(configDir);
  unpatchMemoryFlush(configDir);
  removeFile(path.join(configDir, INCLUDE_FILENAME));
  ok('Plugin files removed');

  startSpinner('Restarting gateway…');
  if (triggerRestart()) ok('Gateway restarted');

  const projectsDir = path.join(configDir, 'workspace', 'projects');
  if (fs.existsSync(projectsDir)) {
    const purge = process.argv.includes('--purge-data')
      || await confirm(`Also delete the plugin's stored data at ${projectsDir}? This cannot be undone.`);
    if (purge) {
      startSpinner('Removing workspace data…');
      fs.rmSync(projectsDir, { recursive: true });
      ok('Workspace data removed');
    } else {
      ok(`Workspace data kept ${c.dim}${projectsDir}${c.reset}`);
      info('Run with --purge-data to remove it later.');
    }
  }

  footer('Uninstall complete');
}

// ── Setup step implementations ────────────────────────────────────────

function checkOpenClawVersion(): string {
  let version: string;
  try {
    version = execSync('openclaw --version', { encoding: 'utf-8' }).trim();
  } catch {
    fail('OpenClaw not found. Install OpenClaw (>=2026.1.0) first.');
    process.exit(1);
  }

  const match = version.match(/(\d+\.\d+\.\d+)/);
  if (!match) {
    warn(`Could not parse version from "${version}". Proceeding anyway.`);
    return version;
  }

  const versionStr = match[1]!;
  if (compareVersions(versionStr, MIN_OPENCLAW_VERSION) < 0) {
    fail(`OpenClaw ${versionStr} found, requires >=${MIN_OPENCLAW_VERSION}. Please upgrade.`);
    process.exit(1);
  }

  return versionStr;
}

function locateConfigDir(): string {
  const envDir = process.env['OPENCLAW_CONFIG_DIR'];
  if (envDir && fs.existsSync(envDir)) {
    return path.resolve(envDir);
  }

  const homeDir = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  const defaultDir = path.join(homeDir, '.openclaw');
  if (fs.existsSync(defaultDir)) {
    return defaultDir;
  }

  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'openclaw.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  fail('Could not find OpenClaw config directory. Set $OPENCLAW_CONFIG_DIR or ensure ~/.openclaw/ exists.');
  process.exit(1);
}

function checkDirPermissions(dir: string): void {
  try {
    const stat = fs.statSync(dir);
    const mode = stat.mode;
    const permissions = (mode & 0o777).toString(8);

    if (mode & 0o002) {
      warn(`${dir} is world-writable (${permissions}). Consider chmod 700.`);
    } else if (mode & 0o020) {
      warn(`${dir} is group-writable (${permissions}). Consider chmod 700.`);
    }
  } catch {
    warn(`Could not check permissions for ${dir}.`);
  }
}

function installPlugin(configDir: string): void {
  const extDir = path.join(configDir, 'extensions', PLUGIN_NAME);
  const alreadyExists = fs.existsSync(path.join(extDir, 'openclaw.plugin.json'));

  const pkgRoot = findPackageRoot();
  if (pkgRoot) {
    for (const req of REQUIRED_PLUGIN_FILES) {
      if (!fs.existsSync(path.join(pkgRoot, req))) {
        fail(`Required file missing: ${req}. Was \`npm run build\` run before publishing?`);
        process.exit(1);
      }
    }
    fs.mkdirSync(extDir, { recursive: true });
    for (const entry of PLUGIN_FILES) {
      const src = path.join(pkgRoot, entry);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(extDir, entry);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      copyRecursive(src, dest);
    }
    ok(alreadyExists ? 'Plugin updated' : 'Plugin installed');
    return;
  }

  if (alreadyExists) {
    ok('Plugin already installed');
    return;
  }

  try {
    execSync(`openclaw plugins install ${PLUGIN_NAME}`, {
      encoding: 'utf-8',
      stdio: 'inherit',
    });
    ok('Plugin installed');
  } catch {
    warn('Could not install plugin. You may need to install manually.');
  }
}

function patchConfig(configDir: string): Record<string, unknown> | null {
  const configPath = path.join(configDir, 'openclaw.json');

  if (!fs.existsSync(configPath)) {
    warn(`${configPath} not found. Skipping config patch.`);
    return null;
  }

  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch {
    warn(`Could not read ${configPath}. Skipping config patch.`);
    return null;
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    warn('Could not parse openclaw.json. Please manually add the $include reference.');
    info(`Add to channels.telegram.groups: { "$include": "./${INCLUDE_FILENAME}" }`);
    return null;
  }

  const hasInclude = content.includes(INCLUDE_FILENAME);
  const hasStaleSkillsDir = content.includes(PLUGIN_NAME) && content.includes('extraDirs');

  // Clean up stale skills.load.extraDirs from pre-v1.4 installs
  if (hasStaleSkillsDir) {
    const skills = config['skills'] as Record<string, unknown> | undefined;
    const load = skills?.['load'] as Record<string, unknown> | undefined;
    if (load && Array.isArray(load['extraDirs'])) {
      load['extraDirs'] = (load['extraDirs'] as string[]).filter(
        (d) => !d.includes(PLUGIN_NAME),
      );
      if ((load['extraDirs'] as string[]).length === 0) delete load['extraDirs'];
      if (Object.keys(load).length === 0) delete skills!['load'];
      if (Object.keys(skills!).length === 0) delete config['skills'];
    }

    // Write the cleaned config even if $include is already present
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  }

  if (hasInclude) {
    ok(hasStaleSkillsDir ? 'Config patched (removed stale skills entry)' : 'Config already patched');
    return null;
  }

  // Extract existing inline groups before overwriting
  let existingGroups: Record<string, unknown> | null = null;

  if (!hasInclude) {
    if (!config['channels']) config['channels'] = {};
    const channels = config['channels'] as Record<string, unknown>;

    if (!channels['telegram']) channels['telegram'] = {};
    const telegram = channels['telegram'] as Record<string, unknown>;

    const groups = telegram['groups'];
    if (groups && typeof groups === 'object' && !('$include' in (groups as Record<string, unknown>))) {
      existingGroups = groups as Record<string, unknown>;
    }

    telegram['groups'] = { $include: `./${INCLUDE_FILENAME}` };
  }

  const bakPath = configPath + '.bak';
  fs.copyFileSync(configPath, bakPath);

  const newContent = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(configPath, newContent, { mode: 0o600 });
  ok('Config patched');

  return existingGroups;
}

function initRegistry(projectsDir: string): void {
  const registryPath = path.join(projectsDir, REGISTRY_FILENAME);

  if (fs.existsSync(registryPath)) {
    return;
  }

  const callbackSecret = crypto.randomBytes(32).toString('hex');
  const registry = {
    version: SETUP_REGISTRY_VERSION,
    topicManagerAdmins: [],
    callbackSecret,
    lastDoctorAllRunAt: null,
    dailyReportCronJobId: null,
    autopilotEnabled: true,
    maxTopics: 100,
    topics: {},
  };

  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', {
    mode: 0o600,
  });
}

function createEmptyInclude(configDir: string, seedGroups?: Record<string, unknown> | null): void {
  const includePath = path.join(configDir, INCLUDE_FILENAME);

  if (fs.existsSync(includePath)) {
    return;
  }

  const body = seedGroups && Object.keys(seedGroups).length > 0
    ? JSON.stringify(seedGroups, null, 2)
    : '{}';

  const content = [
    '// This file is generated by telegram-manager. Do not hand-edit.',
    body,
    '',
  ].join('\n');

  fs.writeFileSync(includePath, content, { mode: 0o600 });
}

const GITIGNORE_ENTRIES = [
  'projects/topics.json',
  'projects/audit.jsonl',
  'projects/*/.tm-backup/',
];

function ensureGitignore(workspaceDir: string): void {
  const gitignorePath = path.join(workspaceDir, '.gitignore');

  let content = '';
  try {
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
    }
  } catch {
    // File doesn't exist yet — that's fine
  }

  const lines = content.split('\n');
  const missing = GITIGNORE_ENTRIES.filter(
    entry => !lines.some(line => line.trim() === entry),
  );

  if (missing.length === 0) return;

  const block = '\n# telegram-manager (operational files)\n' + missing.join('\n') + '\n';
  const newContent = content ? content.trimEnd() + '\n' + block : block.trimStart();

  fs.writeFileSync(gitignorePath, newContent);
}

function writeHeartbeat(configDir: string): void {
  const heartbeatPath = path.join(configDir, 'workspace', 'HEARTBEAT.md');

  // Read existing content if any
  let content = '';
  try {
    if (fs.existsSync(heartbeatPath)) {
      content = fs.readFileSync(heartbeatPath, 'utf-8');
    }
  } catch {
    // File doesn't exist yet — that's fine
  }

  // Idempotent: don't duplicate if marker already present
  if (content.includes(SETUP_MARKER_START)) {
    return;
  }

  const newContent = content
    ? content.trimEnd() + '\n\n' + SETUP_HEARTBEAT_BLOCK + '\n'
    : SETUP_HEARTBEAT_BLOCK + '\n';

  // Atomic write: .tmp → rename
  const tmpPath = heartbeatPath + '.tmp';
  fs.mkdirSync(path.dirname(heartbeatPath), { recursive: true });
  fs.writeFileSync(tmpPath, newContent, { mode: 0o640 });
  fs.renameSync(tmpPath, heartbeatPath);
}

// ── Uninstall step implementations ────────────────────────────────────

function unpatchConfig(configDir: string): void {
  const configPath = path.join(configDir, 'openclaw.json');
  const bakPath = configPath + '.bak';

  if (!fs.existsSync(configPath)) {
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch {
    warn(`Could not read ${configPath}.`);
    return;
  }

  const hasInclude = content.includes(INCLUDE_FILENAME);
  const hasSkillsDir = content.includes(PLUGIN_NAME) && content.includes('extraDirs');

  if (!hasInclude && !hasSkillsDir) {
    return;
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    warn('Could not parse openclaw.json. Please manually remove the $include reference.');
    return;
  }

  // Remove the $include reference and restore inline groups
  if (hasInclude) {
    const channels = config['channels'] as Record<string, unknown> | undefined;
    const telegram = channels?.['telegram'] as Record<string, unknown> | undefined;
    if (telegram) {
      const includeFilePath = path.join(configDir, INCLUDE_FILENAME);
      let restoredGroups: Record<string, unknown> | null = null;
      if (fs.existsSync(includeFilePath)) {
        try {
          const raw = fs.readFileSync(includeFilePath, 'utf-8');
          const parsed = JSON5.parse(raw) as Record<string, unknown>;
          // Strip topic-level config (topics, systemPrompt, etc.) — only keep
          // group-level settings like requireMention
          const cleaned: Record<string, unknown> = {};
          for (const [groupId, groupVal] of Object.entries(parsed)) {
            if (groupVal && typeof groupVal === 'object') {
              const groupSettings: Record<string, unknown> = {};
              for (const [key, val] of Object.entries(groupVal as Record<string, unknown>)) {
                if (key !== 'topics') {
                  groupSettings[key] = val;
                }
              }
              if (Object.keys(groupSettings).length > 0) {
                cleaned[groupId] = groupSettings;
              }
            }
          }
          if (Object.keys(cleaned).length > 0) {
            restoredGroups = cleaned;
          }
        } catch { /* fall through – delete key if we can't parse */ }
      }

      if (restoredGroups) {
        telegram['groups'] = restoredGroups;
      } else {
        delete telegram['groups'];
      }
      if (Object.keys(telegram).length === 0) delete channels!['telegram'];
      if (Object.keys(channels!).length === 0) delete config['channels'];
    }
  }

  // Remove stale skills.load.extraDirs entry from pre-v1.4 installs
  if (hasSkillsDir) {
    const skills = config['skills'] as Record<string, unknown> | undefined;
    const load = skills?.['load'] as Record<string, unknown> | undefined;
    if (load && Array.isArray(load['extraDirs'])) {
      load['extraDirs'] = (load['extraDirs'] as string[]).filter(
        (d) => !d.includes(PLUGIN_NAME),
      );
      if ((load['extraDirs'] as string[]).length === 0) delete load['extraDirs'];
      if (Object.keys(load).length === 0) delete skills!['load'];
      if (Object.keys(skills!).length === 0) delete config['skills'];
    }
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });

  // Clean up stale backup from install time
  if (fs.existsSync(bakPath)) {
    fs.unlinkSync(bakPath);
  }
}

function removeFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function removePluginDir(configDir: string): void {
  const extDir = path.join(configDir, 'extensions', PLUGIN_NAME);
  if (fs.existsSync(extDir)) {
    fs.rmSync(extDir, { recursive: true });
  }
}

// ── Memory flush patching ─────────────────────────────────────────────

function patchMemoryFlush(configDir: string): void {
  const configPath = path.join(configDir, 'openclaw.json');

  if (!fs.existsSync(configPath)) {
    warn('openclaw.json not found. Skipping memoryFlush patch.');
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch {
    warn('Could not read openclaw.json. Skipping memoryFlush patch.');
    return;
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    warn('Could not parse openclaw.json. Skipping memoryFlush patch.');
    return;
  }

  // Navigate to agents.defaults.compaction.memoryFlush.prompt
  if (!config['agents']) config['agents'] = {};
  const agents = config['agents'] as Record<string, unknown>;

  if (!agents['defaults']) agents['defaults'] = {};
  const defaults = agents['defaults'] as Record<string, unknown>;

  if (!defaults['compaction']) defaults['compaction'] = {};
  const compaction = defaults['compaction'] as Record<string, unknown>;

  if (!compaction['memoryFlush']) compaction['memoryFlush'] = {};
  const memoryFlush = compaction['memoryFlush'] as Record<string, unknown>;

  const raw = typeof memoryFlush['prompt'] === 'string' ? memoryFlush['prompt'] : '';

  // Already has the exact current instruction — nothing to do
  if (raw.includes(MEMORY_FLUSH_INSTRUCTION)) {
    ok('Memory flush prompt already patched');
    return;
  }

  // Strip any previous version of our instruction (identified by tag or content fingerprints).
  // The AI may reword our instruction and drop the [tm] tag, so we also match on
  // unique keywords to avoid near-duplicates after uninstall/reinstall cycles.
  const cleaned = raw
    .split('\n')
    .filter(line => !FLUSH_FINGERPRINTS.some(fp => line.includes(fp)))
    .join('\n')
    .trim();

  memoryFlush['prompt'] = cleaned
    ? cleaned + '\n' + MEMORY_FLUSH_INSTRUCTION
    : MEMORY_FLUSH_INSTRUCTION;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  ok('Memory flush prompt patched');
}

function unpatchMemoryFlush(configDir: string): void {
  const configPath = path.join(configDir, 'openclaw.json');

  if (!fs.existsSync(configPath)) return;

  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return;
  }

  if (!FLUSH_FINGERPRINTS.some(fp => content.includes(fp))) return;

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return;
  }

  const agents = config['agents'] as Record<string, unknown> | undefined;
  const defaults = agents?.['defaults'] as Record<string, unknown> | undefined;
  const compaction = defaults?.['compaction'] as Record<string, unknown> | undefined;
  const memoryFlush = compaction?.['memoryFlush'] as Record<string, unknown> | undefined;

  if (!memoryFlush || typeof memoryFlush['prompt'] !== 'string') return;

  const prompt = memoryFlush['prompt'] as string;
  const cleaned = prompt
    .split('\n')
    .filter(line => !FLUSH_FINGERPRINTS.some(fp => line.includes(fp)))
    .join('\n')
    .trim();

  if (cleaned) {
    memoryFlush['prompt'] = cleaned;
  } else {
    delete memoryFlush['prompt'];
    if (Object.keys(memoryFlush).length === 0) delete compaction!['memoryFlush'];
    if (Object.keys(compaction!).length === 0) delete defaults!['compaction'];
    if (Object.keys(defaults!).length === 0) delete agents!['defaults'];
    if (Object.keys(agents!).length === 0) delete config['agents'];
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

// ── Shared helpers ────────────────────────────────────────────────────

function triggerRestart(): boolean {
  try {
    execSync('openclaw gateway restart', {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return true;
  } catch {
    warn('Could not restart gateway. Run `openclaw gateway restart` manually.');
    return false;
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

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

function findPackageRoot(): string | null {
  let dir = path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'openclaw.plugin.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function copyRecursive(src: string, dest: string): void {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// ── Entry point (must be last — all constants/functions must be
//    initialized before runSetup() executes synchronously) ─────────────

const command = process.argv[2] ?? 'setup';

if (command === 'setup') {
  runSetup().catch((err) => {
    stopSpinner();
    console.error('Setup failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
} else if (command === 'uninstall') {
  runUninstall().catch((err) => {
    stopSpinner();
    console.error('Uninstall failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
} else {
  console.error(`Unknown command: ${command}`);
  console.error(`Usage: ${PLUGIN_NAME} [setup|uninstall [--purge-data]]`);
  process.exit(1);
}
