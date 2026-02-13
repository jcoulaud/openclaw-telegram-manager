import * as fs from 'node:fs';
import * as path from 'node:path';
import JSON5 from 'json5';
import {
  Severity,
  CAPSULE_VERSION,
  OVERLAY_FILES,
  SPAM_THRESHOLD,
} from './types.js';
import type { TopicEntry, DoctorCheckResult, Registry } from './types.js';
import { jailCheck } from './security.js';
import { computeRegistryHash, extractRegistryHash } from './include-generator.js';

function check(
  severity: DoctorCheckResult['severity'],
  checkId: string,
  message: string,
  fixable: boolean,
  remediation?: string,
): DoctorCheckResult {
  return remediation
    ? { severity, checkId, message, fixable, remediation }
    : { severity, checkId, message, fixable };
}

// ── Registry / mapping checks ──────────────────────────────────────────

/**
 * Check that the registry entry's capsule path exists on disk.
 */
export function runRegistryChecks(
  entry: TopicEntry,
  projectsBase: string,
): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];
  const capsuleDir = path.join(projectsBase, entry.slug);

  // Check path exists
  if (!fs.existsSync(capsuleDir)) {
    results.push(
      check(Severity.ERROR, 'pathMissing', `Project folder is missing (projects/${entry.slug}/)`, false, 'Run /tm init to recreate it'),
    );
    return results; // No point checking further if path doesn't exist
  }

  // Check that the folder name matches the slug
  try {
    const stat = fs.statSync(capsuleDir);
    if (!stat.isDirectory()) {
      results.push(
        check(Severity.ERROR, 'pathNotDir', 'Topic path exists but is not a folder', false),
      );
    }
  } catch {
    results.push(
      check(Severity.ERROR, 'pathStatFailed', 'Cannot verify topic folder on disk', false),
    );
  }

  return results;
}

// ── Orphan detection ───────────────────────────────────────────────────

/**
 * Check for capsule folders in projects/ that have no matching registry entry.
 */
export function runOrphanCheck(
  projectsBase: string,
  registrySlugs: Set<string>,
): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectsBase, { withFileTypes: true });
  } catch {
    return results; // Can't read directory — skip
  }

  for (const dirent of entries) {
    if (!dirent.isDirectory()) continue;
    // Skip hidden dirs and special files
    if (dirent.name.startsWith('.') || dirent.name === 'audit.jsonl') continue;

    if (!registrySlugs.has(dirent.name)) {
      results.push(
        check(
          Severity.WARN,
          'orphanFolder',
          `Unregistered folder found: ${dirent.name}`,
          false,
        ),
      );
    }
  }

  return results;
}

// ── Capsule structure checks ───────────────────────────────────────────

/**
 * Check capsule structure: required files, overlay files, capsule version.
 */
export function runCapsuleChecks(
  entry: TopicEntry,
  projectsBase: string,
): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];
  const capsuleDir = path.join(projectsBase, entry.slug);

  if (!fs.existsSync(capsuleDir)) return results;

  // STATUS.md is critical
  if (!fs.existsSync(path.join(capsuleDir, 'STATUS.md'))) {
    results.push(
      check(Severity.ERROR, 'statusMissing', 'Status file is missing', true, 'Run /tm upgrade to recreate it'),
    );
  }

  // TODO.md is important
  if (!fs.existsSync(path.join(capsuleDir, 'TODO.md'))) {
    results.push(
      check(Severity.WARN, 'todoMissing', 'TODO file is missing', true, 'Run /tm upgrade to recreate it'),
    );
  }

  // Overlay files are optional but worth noting
  const overlays = OVERLAY_FILES[entry.type] ?? [];
  for (const file of overlays) {
    if (!fs.existsSync(path.join(capsuleDir, file))) {
      results.push(
        check(Severity.INFO, `overlayMissing:${file}`, `Optional overlay ${file} missing for type "${entry.type}"`, true),
      );
    }
  }

  // Capsule version behind
  if (entry.capsuleVersion < CAPSULE_VERSION) {
    results.push(
      check(
        Severity.INFO,
        'capsuleVersionBehind',
        `Topic files are outdated (v${entry.capsuleVersion} → v${CAPSULE_VERSION}). Will auto-upgrade on next command.`,
        false,
      ),
    );
  }

  return results;
}

// ── STATUS.md quality checks ───────────────────────────────────────────

const LAST_DONE_RE = /^##\s*Last done\s*\(UTC\)/im;
const NEXT_ACTIONS_RE = /^##\s*Next (?:3 )?actions(?: \(now\))?/im;
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const TASK_ID_RE = /\[T-\d+\]/g;
const ADHOC_RE = /\[AD-HOC\]/g;

/**
 * Check STATUS.md content quality.
 */
export function runStatusQualityChecks(
  statusContent: string,
  entry: TopicEntry,
): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];

  // "Last done (UTC)" section check
  if (!LAST_DONE_RE.test(statusContent)) {
    results.push(
      check(Severity.ERROR, 'lastDoneMissing', 'Status file is missing the last activity section', true, 'The AI will fix this on next interaction'),
    );
  } else {
    // Check for timestamp in the section
    const lastDoneIndex = statusContent.search(LAST_DONE_RE);
    const sectionAfter = statusContent.slice(lastDoneIndex);
    const nextSectionIndex = sectionAfter.indexOf('\n## ', 1);
    const lastDoneSection = nextSectionIndex > 0
      ? sectionAfter.slice(0, nextSectionIndex)
      : sectionAfter;

    if (!TIMESTAMP_RE.test(lastDoneSection)) {
      results.push(
        check(Severity.ERROR, 'lastDoneNoTimestamp', 'Last activity has no timestamp', true, 'The AI will fix this on next interaction'),
      );
    } else if (entry.status === 'active') {
      // Check timestamp age (default: 3 days)
      const tsMatch = lastDoneSection.match(TIMESTAMP_RE);
      if (tsMatch) {
        const ts = new Date(tsMatch[0]);
        const ageDays = (Date.now() - ts.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > 3) {
          results.push(
            check(
              Severity.WARN,
              'lastDoneStale',
              `No activity for ${Math.floor(ageDays)} days`,
              false,
              'Send a message to resume, or /tm snooze 7d to silence',
            ),
          );
        }
      }
    }
  }

  // "Next actions (now)" section check
  if (!NEXT_ACTIONS_RE.test(statusContent)) {
    results.push(
      check(Severity.ERROR, 'nextActionsMissing', 'Status file is missing the next actions section', true, 'The AI will fix this on next interaction'),
    );
  } else {
    // Check that next actions contain task IDs
    const nextActionsIndex = statusContent.search(NEXT_ACTIONS_RE);
    const sectionAfter = statusContent.slice(nextActionsIndex);
    const nextSectionIndex = sectionAfter.indexOf('\n## ', 1);
    const nextActionsSection = nextSectionIndex > 0
      ? sectionAfter.slice(0, nextSectionIndex)
      : sectionAfter;

    const taskIds = nextActionsSection.match(TASK_ID_RE) ?? [];
    const adhocs = nextActionsSection.match(ADHOC_RE) ?? [];

    if (taskIds.length === 0 && adhocs.length === 0) {
      results.push(
        check(
          Severity.WARN,
          'nextActionsEmpty',
          'No next actions defined yet',
          false,
          'Send a message with your next task to get started',
        ),
      );
    }
  }

  return results;
}

// ── Next vs TODO cross-reference ───────────────────────────────────────

/**
 * Check that task IDs in "Next actions (now)" exist in TODO.md.
 */
export function runNextVsTodoChecks(
  statusContent: string,
  todoContent: string,
): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];

  // Extract next actions section
  const nextActionsIndex = statusContent.search(NEXT_ACTIONS_RE);
  if (nextActionsIndex < 0) return results;

  const sectionAfter = statusContent.slice(nextActionsIndex);
  const nextSectionIndex = sectionAfter.indexOf('\n## ', 1);
  const nextActionsSection = nextSectionIndex > 0
    ? sectionAfter.slice(0, nextSectionIndex)
    : sectionAfter;

  // Get task IDs from next actions
  const nextTaskIds = nextActionsSection.match(TASK_ID_RE) ?? [];
  if (nextTaskIds.length === 0) return results;

  // Get task IDs from TODO
  const todoTaskIds = new Set(todoContent.match(TASK_ID_RE) ?? []);

  // Find task IDs in next that are not in TODO
  const missing = nextTaskIds.filter((id) => !todoTaskIds.has(id));

  // Only warn if 2+ are missing (allows 1 stale reference)
  if (missing.length >= 2) {
    results.push(
      check(
        Severity.WARN,
        'nextNotInTodo',
        `${missing.length} tasks referenced in next actions don't exist in the TODO list: ${missing.join(', ')}`,
        false,
        'The AI will clean these up on next interaction',
      ),
    );
  }

  return results;
}

// ── Commands / Links checks ────────────────────────────────────────────

/**
 * Check COMMANDS.md and LINKS.md for relevant topic types.
 */
export function runCommandsLinksChecks(
  entry: TopicEntry,
  capsuleFiles: Map<string, string>,
): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];

  // COMMANDS.md empty for coding topics
  if (entry.type === 'coding') {
    const commandsContent = capsuleFiles.get('COMMANDS.md');
    if (commandsContent !== undefined && isEffectivelyEmpty(commandsContent)) {
      results.push(
        check(Severity.INFO, 'commandsEmpty', 'COMMANDS.md is empty for a coding topic', false, 'Add build/test/deploy commands to COMMANDS.md'),
      );
    }
  }

  // LINKS.md empty for coding or research
  if (entry.type === 'coding' || entry.type === 'research') {
    const linksContent = capsuleFiles.get('LINKS.md');
    if (linksContent !== undefined && isEffectivelyEmpty(linksContent)) {
      results.push(
        check(Severity.INFO, 'linksEmpty', 'LINKS.md is empty for a coding/research topic', false, 'Add URLs and endpoints to LINKS.md'),
      );
    }
  }

  return results;
}

/**
 * Check if a markdown file is effectively empty (only has a heading and template text).
 */
function isEffectivelyEmpty(content: string): boolean {
  // Remove markdown heading lines and template placeholders
  const stripped = content
    .replace(/^#.*$/gm, '')           // headings
    .replace(/^_.*_$/gm, '')          // italic template text
    .replace(/\s+/g, '')              // whitespace
    .trim();
  return stripped.length === 0;
}

// ── Cron checks ────────────────────────────────────────────────────────

const JOB_ID_RE = /[a-zA-Z0-9_-]{8,}/;

/**
 * Check CRON.md for job ID presence and optionally validate against cron/jobs.json.
 */
export function runCronChecks(
  cronContent: string,
  cronJobsPath?: string,
): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];

  // Skip if cron content is effectively empty
  if (isEffectivelyEmpty(cronContent)) return results;

  // Check for job IDs in CRON.md
  const lines = cronContent.split('\n').filter((l) => !l.startsWith('#') && l.trim().length > 0);
  const hasJobIds = lines.some((line) => JOB_ID_RE.test(line));

  if (!hasJobIds) {
    results.push(
      check(Severity.WARN, 'cronNoJobIds', 'Scheduled jobs are listed but have no recognizable job IDs', false),
    );
    return results;
  }

  // Optionally validate job IDs against cron/jobs.json
  if (cronJobsPath && fs.existsSync(cronJobsPath)) {
    try {
      const jobsRaw = fs.readFileSync(cronJobsPath, 'utf-8');
      const jobs = JSON.parse(jobsRaw) as Record<string, unknown>;
      const knownJobIds = new Set(Object.keys(jobs));

      // Extract job IDs from CRON.md lines
      for (const line of lines) {
        const match = line.match(JOB_ID_RE);
        if (match && !knownJobIds.has(match[0])) {
          results.push(
            check(
              Severity.WARN,
              'cronJobNotFound',
              `Scheduled job "${match[0]}" not found in the jobs registry`,
              false,
            ),
          );
        }
      }
    } catch {
      // Can't read jobs file — skip validation
    }
  }

  return results;
}

// ── Config enforcement checks ──────────────────────────────────────────

/**
 * Check per-topic systemPrompt and skills against canonical templates.
 */
export function runConfigChecks(
  entry: TopicEntry,
  includeContent: string,
  registry: Registry,
): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];

  // Parse the include to check this topic's config (JSON5 handles // comments natively)
  let includeObj: Record<string, unknown>;
  try {
    includeObj = JSON5.parse(includeContent) as Record<string, unknown>;
  } catch {
    return results;
  }

  const groupConfig = includeObj[entry.groupId] as Record<string, unknown> | undefined;
  if (!groupConfig) {
    results.push(
      check(Severity.WARN, 'configGroupMissing', 'Config is out of sync', false, 'Run /tm sync to fix'),
    );
    return results;
  }

  const topics = groupConfig['topics'] as Record<string, unknown> | undefined;
  const topicConfig = topics?.[entry.threadId] as Record<string, unknown> | undefined;

  if (!topicConfig) {
    results.push(
      check(Severity.WARN, 'configTopicMissing', 'Topic not found in system config', false, 'Run /tm sync to fix'),
    );
    return results;
  }

  // Check systemPrompt exists
  if (!topicConfig['systemPrompt']) {
    results.push(
      check(Severity.WARN, 'configNoSystemPrompt', 'AI instructions are missing for this topic', false, 'Run /tm sync to fix'),
    );
  }

  // Check skills exist
  if (!topicConfig['skills'] || !Array.isArray(topicConfig['skills'])) {
    results.push(
      check(Severity.WARN, 'configNoSkills', 'Command list is missing for this topic', false, 'Run /tm sync to fix'),
    );
  }

  return results;
}

// ── Include drift detection ────────────────────────────────────────────

/**
 * Check if the generated include file's registry-hash matches the current registry.
 */
export function runIncludeDriftCheck(
  includeFileContent: string,
  registry: Registry,
): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];

  const fileHash = extractRegistryHash(includeFileContent);
  if (!fileHash) {
    results.push(
      check(
        Severity.WARN,
        'includeDrift',
        'Config is out of sync with your topics',
        false,
        'Run /tm sync to fix',
      ),
    );
    return results;
  }

  const currentHash = computeRegistryHash(registry.topics);

  if (fileHash !== currentHash) {
    results.push(
      check(
        Severity.WARN,
        'includeDrift',
        'Config is out of sync with your topics',
        false,
        'Run /tm sync to fix',
      ),
    );
  }

  return results;
}

// ── Spam control check ─────────────────────────────────────────────────

/**
 * Check for spam control: if consecutiveSilentDoctors >= 3, suggest auto-snooze.
 */
export function runSpamControlCheck(
  entry: TopicEntry,
): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];

  if (entry.consecutiveSilentDoctors >= SPAM_THRESHOLD) {
    results.push(
      check(
        Severity.INFO,
        'spamControl',
        `No activity for a while \u2014 auto-snoozing for 30 days`,
        true,
        'Send a message to resume',
      ),
    );
  }

  return results;
}

// ── Post error check ────────────────────────────────────────────────

/**
 * Check if the last report delivery failed for this topic.
 */
export function runPostErrorCheck(
  entry: TopicEntry,
): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];

  if (entry.lastPostError) {
    results.push(
      check(
        Severity.WARN,
        'lastPostFailed',
        `Last report delivery failed: ${entry.lastPostError}`,
        false,
        'This will be retried on the next health check cycle',
      ),
    );
  }

  return results;
}

// ── Convenience: run all checks for a single topic ─────────────────────

/**
 * Run all applicable doctor checks for a single topic entry.
 * Returns combined results from all check categories.
 *
 * This is a convenience function for command handlers.
 * It reads capsule files and runs all checks.
 */
export function runAllChecksForTopic(
  entry: TopicEntry,
  projectsBase: string,
  includeContent?: string,
  registry?: Registry,
  cronJobsPath?: string,
): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];
  const capsuleDir = path.join(projectsBase, entry.slug);

  // Registry checks
  results.push(...runRegistryChecks(entry, projectsBase));

  // Post error check (before capsule-dependent checks)
  results.push(...runPostErrorCheck(entry));

  // If path doesn't exist, skip capsule-dependent checks
  if (!fs.existsSync(capsuleDir)) return results;

  // Capsule structure checks
  results.push(...runCapsuleChecks(entry, projectsBase));

  // Read capsule files for content-based checks
  const capsuleFiles = readCapsuleFiles(capsuleDir);

  // STATUS quality checks
  const statusContent = capsuleFiles.get('STATUS.md');
  if (statusContent) {
    results.push(...runStatusQualityChecks(statusContent, entry));

    // Next vs TODO checks
    const todoContent = capsuleFiles.get('TODO.md');
    if (todoContent) {
      results.push(...runNextVsTodoChecks(statusContent, todoContent));
    }
  }

  // Commands / Links checks
  results.push(...runCommandsLinksChecks(entry, capsuleFiles));

  // Cron checks
  const cronContent = capsuleFiles.get('CRON.md');
  if (cronContent) {
    results.push(...runCronChecks(cronContent, cronJobsPath));
  }

  // Config checks (if include content provided)
  if (includeContent && registry) {
    results.push(...runConfigChecks(entry, includeContent, registry));
  }

  // Include drift (if include content provided)
  if (includeContent && registry) {
    results.push(...runIncludeDriftCheck(includeContent, registry));
  }

  // Spam control
  results.push(...runSpamControlCheck(entry));

  return results;
}

// ── Backup helper ──────────────────────────────────────────────────────

const BACKUP_DIR = '.tm-backup';
const BACKUP_FILES = ['STATUS.md', 'TODO.md'];

/**
 * Snapshot STATUS.md and TODO.md to .tm-backup/ when all checks pass.
 * Only creates a backup if no ERROR or WARN findings exist.
 */
export function backupCapsuleIfHealthy(
  projectsBase: string,
  slug: string,
  results: DoctorCheckResult[],
): void {
  const hasIssues = results.some(r => r.severity === Severity.ERROR || r.severity === Severity.WARN);
  if (hasIssues) return;

  const capsuleDir = path.join(projectsBase, slug);
  const backupDir = path.join(capsuleDir, BACKUP_DIR);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  for (const file of BACKUP_FILES) {
    const src = path.join(capsuleDir, file);
    const dst = path.join(backupDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    }
  }
}

// ── File reading helper ────────────────────────────────────────────────

function readCapsuleFiles(capsuleDir: string): Map<string, string> {
  const files = new Map<string, string>();
  const filenames = [
    'STATUS.md', 'TODO.md', 'COMMANDS.md', 'LINKS.md',
    'CRON.md', 'NOTES.md', 'README.md', 'LEARNINGS.md',
    'ARCHITECTURE.md', 'DEPLOY.md',
    'SOURCES.md', 'FINDINGS.md',
    'CAMPAIGNS.md', 'METRICS.md',
  ];

  for (const name of filenames) {
    const filePath = path.join(capsuleDir, name);
    try {
      if (fs.existsSync(filePath)) {
        files.set(name, fs.readFileSync(filePath, 'utf-8'));
      }
    } catch {
      // Skip unreadable files
    }
  }

  return files;
}
