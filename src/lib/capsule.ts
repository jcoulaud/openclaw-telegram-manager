import * as fs from 'node:fs';
import * as path from 'node:path';
import { BASE_FILES, OVERLAY_FILES, CAPSULE_VERSION } from './types.js';
import type { TopicType } from './types.js';
import { jailCheck, rejectSymlink } from './security.js';

// ── Template content (embedded string constants) ───────────────────────
// These are the source-of-truth defaults, matching src/templates/.

const README_UNIVERSAL = (name: string) =>
  `# ${name}

## What is this about?

_Describe what this topic is about._

## Goal

_What does success look like?_

## Key resources

_URLs, repos, paths, dashboards — anything the AI needs after a reset._
`;

const README_TYPE_SECTIONS: Record<TopicType, (name: string) => string> = {
  coding: () => `
## Architecture

_Components, data flow, key decisions._

## Deployment

_Environments, deploy steps, rollback._

## Commands

_Build, test, deploy — kept here so they survive a reset._
`,
  research: () => `
## Sources

_Papers, articles, datasets, APIs._

## Findings

_Key findings, evidence, recommendations._
`,
  marketing: () => `
## Campaigns

_Active campaigns, audiences, channels._

## Metrics

_KPIs, targets, tracking dashboards._
`,
  general: () => '',
};

const BASE_TEMPLATES: Record<string, (name: string, type?: TopicType) => string> = {
  'README.md': (name, type) => {
    const universal = README_UNIVERSAL(name);
    const extra = type ? README_TYPE_SECTIONS[type](name) : '';
    return universal + extra;
  },

  'STATUS.md': (name) =>
    `# Status: ${name}\n\n## Last done (UTC)\n\n${new Date().toISOString()}\nTopic created. Waiting for first instructions.\n\n## Next actions (now)\n\n_None yet._\n\n## Upcoming actions\n\n_None yet._\n\n## Backlog\n\n- [T-1] _e.g. Set up project scaffolding_\n\n## Completed\n\n_None yet._\n`,

  'LEARNINGS.md': (name) =>
    `# Learnings: ${name}\n\n_Hard-won insights, mistakes, and workarounds._\n_Agent prepends here automatically. Most recent entries first._\n`,
};

// ── File permissions ───────────────────────────────────────────────────

const CAPSULE_FILE_MODE = 0o640;

// ── Scaffold ───────────────────────────────────────────────────────────

/**
 * Scaffold a new capsule directory with base kit + type-specific README sections.
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
      fs.writeFileSync(filePath, templateFn(name, type), { mode: CAPSULE_FILE_MODE });
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
 * v3→v4: append Backlog + Completed sections to STATUS.md if missing,
 * replace default README.md with new template if still at default.
 * Never deletes old files (LINKS.md, TODO.md, etc.) — they may have user content.
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
        fs.writeFileSync(filePath, templateFn(name, type), { mode: CAPSULE_FILE_MODE });
        addedFiles.push(file);
      }
    }
  }

  // v3→v4 specific upgrades
  if (currentVersion < 4) {
    // Append Backlog + Completed sections to STATUS.md if missing
    const statusPath = path.join(capsuleDir, 'STATUS.md');
    if (fs.existsSync(statusPath)) {
      const content = fs.readFileSync(statusPath, 'utf-8');
      if (!content.includes('## Backlog')) {
        const appendix = '\n## Backlog\n\n- [T-1] _e.g. Set up project scaffolding_\n\n## Completed\n\n_None yet._\n';
        fs.writeFileSync(statusPath, content.trimEnd() + '\n' + appendix, { mode: CAPSULE_FILE_MODE });
      }
    }

    // Replace README.md with new template if still at default
    const readmePath = path.join(capsuleDir, 'README.md');
    if (fs.existsSync(readmePath)) {
      const content = fs.readFileSync(readmePath, 'utf-8');
      if (content.includes('_Describe what this topic is about._') && !content.includes('## Goal')) {
        const templateFn = BASE_TEMPLATES['README.md'];
        if (templateFn) {
          fs.writeFileSync(readmePath, templateFn(name, type), { mode: CAPSULE_FILE_MODE });
        }
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
