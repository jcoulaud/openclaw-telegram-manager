import * as fs from 'node:fs';
import * as path from 'node:path';
import { BASE_FILES, OVERLAY_FILES, CAPSULE_VERSION } from './types.js';
import type { TopicType } from './types.js';
import { jailCheck, rejectSymlink } from './security.js';

// ── Template content (embedded string constants) ───────────────────────
// These are the source-of-truth defaults, matching src/templates/.

const BASE_TEMPLATES: Record<string, (name: string) => string> = {
  'README.md': (name) =>
    `# ${name}\n\n_Describe what this topic is about._\n`,

  'STATUS.md': (name) =>
    `# Status: ${name}\n\n## Last done (UTC)\n\n${new Date().toISOString()}\n\nTopic created. Waiting for first instructions.\n\n## Next actions (now)\n\n_None yet._\n\n## Upcoming actions\n\n_None yet._\n`,

  'TODO.md': (name) =>
    `# TODO: ${name}\n\n## Backlog\n\n- [T-1] _e.g. Set up project scaffolding_\n- [T-2] _Waiting for next task_\n- [T-3] _Waiting for next task_\n\n## Completed\n\n_None yet._\n`,

  'COMMANDS.md': (name) =>
    `# Commands: ${name}\n\n_Build, deploy, test, and other commands for this topic. Kept here so they're not lost on reset._\n`,

  'LINKS.md': (name) =>
    `# Links: ${name}\n\n_URLs, paths, and service endpoints for this topic._\n`,

  'CRON.md': (name) =>
    `# Cron: ${name}\n\n_Cron job IDs and schedules for this topic._\n`,

  'NOTES.md': (name) =>
    `# Notes: ${name}\n\n_Anything worth remembering about this topic._\n`,

  'LEARNINGS.md': (name) =>
    `# Learnings: ${name}\n\n_Hard-won insights, mistakes, and workarounds._\n_Agent prepends here automatically. Most recent entries first._\n`,
};

const OVERLAY_TEMPLATES: Record<string, (name: string) => string> = {
  'ARCHITECTURE.md': (name) =>
    `# Architecture: ${name}\n\n_Components, data flow, dependencies, and design decisions._\n`,

  'DEPLOY.md': (name) =>
    `# Deployment: ${name}\n\n_Environments, deployment steps, rollback procedures, and infra details._\n`,

  'SOURCES.md': (name) =>
    `# Sources: ${name}\n\n_Papers, articles, datasets, APIs, and other reference material._\n`,

  'FINDINGS.md': (name) =>
    `# Findings: ${name}\n\n_Conclusions, insights, data summaries, and recommendations._\n`,

  'CAMPAIGNS.md': (name) =>
    `# Campaigns: ${name}\n\n_Active campaigns, target audiences, channels, timelines, and budgets._\n`,

  'METRICS.md': (name) =>
    `# Metrics: ${name}\n\n_KPIs, conversion rates, engagement stats, and performance data._\n`,
};

// ── File permissions ───────────────────────────────────────────────────

const CAPSULE_FILE_MODE = 0o640;

// ── Scaffold ───────────────────────────────────────────────────────────

/**
 * Scaffold a new capsule directory with base kit + type overlays.
 * Uses fs.mkdirSync with exclusive flag as the atomic reservation mechanism.
 * Throws if the directory already exists (collision).
 *
 * @param slug - stable ID used for directory name
 * @param name - human-readable label used in template headers
 */
export function scaffoldCapsule(
  projectsBase: string,
  slug: string,
  name: string,
  type: TopicType,
): void {
  const capsuleDir = path.join(projectsBase, slug);

  // Path jail check
  if (!jailCheck(projectsBase, slug)) {
    throw new Error(`Path escapes projects directory: ${slug}`);
  }

  // Symlink check on parent
  if (rejectSymlink(projectsBase)) {
    throw new Error('Detected an unsafe file system configuration (symlink)');
  }

  // Atomic directory creation (exclusive)
  fs.mkdirSync(capsuleDir, { recursive: false });

  // Write base files
  for (const file of BASE_FILES) {
    const templateFn = BASE_TEMPLATES[file];
    if (templateFn) {
      const filePath = path.join(capsuleDir, file);
      fs.writeFileSync(filePath, templateFn(name), { mode: CAPSULE_FILE_MODE });
    }
  }

  // Write overlay files for the type
  const overlays = OVERLAY_FILES[type];
  for (const file of overlays) {
    const templateFn = OVERLAY_TEMPLATES[file];
    if (templateFn) {
      const filePath = path.join(capsuleDir, file);
      fs.writeFileSync(filePath, templateFn(name), { mode: CAPSULE_FILE_MODE });
    }
  }
}

// ── Upgrade ────────────────────────────────────────────────────────────

export interface UpgradeResult {
  upgraded: boolean;
  newVersion: number;
  addedFiles: string[];
}

/**
 * Upgrade an existing capsule to the latest template version.
 * Adds missing files without overwriting existing ones.
 *
 * @param slug - stable ID used for directory name
 * @param name - human-readable label used in template headers
 */
export function upgradeCapsule(
  projectsBase: string,
  slug: string,
  name: string,
  type: TopicType,
  currentVersion: number,
): UpgradeResult {
  if (currentVersion >= CAPSULE_VERSION) {
    return { upgraded: false, newVersion: currentVersion, addedFiles: [] };
  }

  const capsuleDir = path.join(projectsBase, slug);

  if (!jailCheck(projectsBase, slug)) {
    throw new Error(`Path escapes projects directory: ${slug}`);
  }

  if (rejectSymlink(capsuleDir)) {
    throw new Error('Topic directory is a symlink — this is not allowed for security reasons.');
  }

  const addedFiles: string[] = [];

  // Add missing base files
  for (const file of BASE_FILES) {
    const filePath = path.join(capsuleDir, file);
    if (!fs.existsSync(filePath)) {
      const templateFn = BASE_TEMPLATES[file];
      if (templateFn) {
        fs.writeFileSync(filePath, templateFn(name), { mode: CAPSULE_FILE_MODE });
        addedFiles.push(file);
      }
    }
  }

  // Add missing overlay files
  const overlays = OVERLAY_FILES[type];
  for (const file of overlays) {
    const filePath = path.join(capsuleDir, file);
    if (!fs.existsSync(filePath)) {
      const templateFn = OVERLAY_TEMPLATES[file];
      if (templateFn) {
        fs.writeFileSync(filePath, templateFn(name), { mode: CAPSULE_FILE_MODE });
        addedFiles.push(file);
      }
    }
  }

  return {
    upgraded: true,
    newVersion: CAPSULE_VERSION,
    addedFiles,
  };
}

// ── No-op write guard ───────────────────────────────────────────────────

/**
 * Write a capsule file only if its content has actually changed.
 * Returns true if the file was written, false if skipped (identical content).
 */
export function writeCapsuleFileIfChanged(filePath: string, newContent: string): boolean {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8');
    if (existing === newContent) return false;
  }
  fs.writeFileSync(filePath, newContent, { mode: CAPSULE_FILE_MODE });
  return true;
}

// ── Validate ───────────────────────────────────────────────────────────

export interface CapsuleValidation {
  missing: string[];
  present: string[];
}

/**
 * Validate that a capsule has all expected files.
 * Returns lists of present and missing files.
 */
export function validateCapsule(
  projectsBase: string,
  slug: string,
  type: TopicType,
): CapsuleValidation {
  const capsuleDir = path.join(projectsBase, slug);

  if (!jailCheck(projectsBase, slug)) {
    throw new Error(`Path escapes projects directory: ${slug}`);
  }

  const expectedFiles = [...BASE_FILES, ...OVERLAY_FILES[type]];
  const missing: string[] = [];
  const present: string[] = [];

  for (const file of expectedFiles) {
    const filePath = path.join(capsuleDir, file);
    if (fs.existsSync(filePath)) {
      present.push(file);
    } else {
      missing.push(file);
    }
  }

  return { missing, present };
}
