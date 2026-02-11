#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';

// ── Constants ──────────────────────────────────────────────────────────

const PLUGIN_NAME = 'openclaw-telegram-manager';
const PLUGIN_VERSION: string = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
).version;
const MIN_OPENCLAW_VERSION = '2026.1.0';
const INCLUDE_FILENAME = 'telegram-manager.generated.groups.json5';
const REGISTRY_FILENAME = 'topics.json';
const PLUGIN_FILES = ['openclaw.plugin.json', 'dist/plugin.js', 'skills', 'package.json'];
const REQUIRED_PLUGIN_FILES = ['openclaw.plugin.json', 'dist/plugin.js'];
const SKILLS_DIR_RELATIVE = `extensions/${PLUGIN_NAME}/skills`;

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

// ── Entry point ───────────────────────────────────────────────────────

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
  console.error(`Usage: ${PLUGIN_NAME} [setup|uninstall]`);
  process.exit(1);
}

// ── Setup ─────────────────────────────────────────────────────────────

async function runSetup(): Promise<void> {
  banner(PLUGIN_NAME, `v${PLUGIN_VERSION}`);

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

  startSpinner('Preparing workspace…');
  const projectsDir = path.join(configDir, 'workspace', 'projects');
  ensureDir(projectsDir);
  initRegistry(projectsDir);
  createEmptyInclude(configDir, existingGroups);
  ok('Workspace ready');

  startSpinner('Restarting gateway…');
  if (triggerRestart()) ok('Gateway restarted');

  footer('Setup complete');

  console.log(`  ${c.dim}Next steps:${c.reset}`);
  console.log(`  ${c.dim}1.${c.reset} Open any Telegram forum topic`);
  console.log(`  ${c.dim}2.${c.reset} Type ${c.cyan}/topic init${c.reset}`);
  console.log(`  ${c.dim}3.${c.reset} The topic will be registered and a capsule created`);
  console.log('');
}

// ── Uninstall ─────────────────────────────────────────────────────────

async function runUninstall(): Promise<void> {
  banner(PLUGIN_NAME, 'uninstall');

  startSpinner('Locating config…');
  const configDir = locateConfigDir();
  ok(`Config ${c.dim}${configDir}${c.reset}`);

  startSpinner('Removing plugin…');
  removePluginDir(configDir);
  unpatchConfig(configDir);
  removeFile(path.join(configDir, INCLUDE_FILENAME));
  ok('Plugin files removed');

  startSpinner('Restarting gateway…');
  if (triggerRestart()) ok('Gateway restarted');

  const projectsDir = path.join(configDir, 'workspace', 'projects');
  if (fs.existsSync(projectsDir)) {
    info('Workspace data kept: ' + projectsDir);
    info('To remove: rm -rf ' + projectsDir);
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
  const hasSkillsDir = content.includes(SKILLS_DIR_RELATIVE);

  if (hasInclude && hasSkillsDir) {
    ok('Config already patched');
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

  // Register skills directory so the gateway discovers our /topic skill
  if (!hasSkillsDir) {
    if (!config['skills']) config['skills'] = {};
    const skills = config['skills'] as Record<string, unknown>;

    if (!skills['load']) skills['load'] = {};
    const load = skills['load'] as Record<string, unknown>;

    const extraDirs = Array.isArray(load['extraDirs']) ? load['extraDirs'] as string[] : [];
    extraDirs.push(`./${SKILLS_DIR_RELATIVE}`);
    load['extraDirs'] = extraDirs;
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
  const hasSkillsDir = content.includes(SKILLS_DIR_RELATIVE);

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
      const includePath = path.join(configDir, INCLUDE_FILENAME);
      let restoredGroups: Record<string, unknown> | null = null;
      if (fs.existsSync(includePath)) {
        try {
          const raw = fs.readFileSync(includePath, 'utf-8');
          const jsonBody = raw.replace(/^\s*\/\/.*$/gm, '').trim();
          const parsed = JSON.parse(jsonBody) as Record<string, unknown>;
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            restoredGroups = parsed;
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

  // Remove skills.load.extraDirs entry for our plugin
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
