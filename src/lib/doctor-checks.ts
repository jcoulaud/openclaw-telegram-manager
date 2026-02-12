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

// ── Helper: check if a checkId should be ignored ───────────────────────

function isIgnored(entry: TopicEntry, checkId: string): boolean {
  return entry.ignoreChecks.includes(checkId);
}

function check(
  severity: DoctorCheckResult['severity'],
  checkId: string,
  message: string,
  fixable: boolean,
): DoctorCheckResult {
  return { severity, checkId, message, fixable };
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
      check(Severity.ERROR, 'pathMissing', `Capsule path does not exist: projects/${entry.slug}/`, false),
    );
    return results; // No point checking further if path doesn't exist
  }

  // Check that the folder name matches the slug
  try {
    const stat = fs.statSync(capsuleDir);
    if (!stat.isDirectory()) {
      results.push(
        check(Severity.ERROR, 'pathNotDir', `projects/${entry.slug} exists but is not a directory`, false),
      );
    }
  } catch {
    results.push(
      check(Severity.ERROR, 'pathStatFailed', `Cannot stat projects/${entry.slug}/`, false),
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
          `Folder projects/${dirent.name}/ has no registry entry. Register with /tm init or delete.`,
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
      check(Severity.ERROR, 'statusMissing', 'STATUS.md is missing from capsule', true),
    );
  }

  // TODO.md is important
  if (!fs.existsSync(path.join(capsuleDir, 'TODO.md'))) {
    if (!isIgnored(entry, 'todoMissing')) {
      results.push(
        check(Severity.WARN, 'todoMissing', 'TODO.md is missing from capsule', true),
      );
    }
  }

  // Overlay files are optional but worth noting
  const overlays = OVERLAY_FILES[entry.type] ?? [];
  for (const file of overlays) {
    if (!fs.existsSync(path.join(capsuleDir, file))) {
      const checkId = `overlayMissing:${file}`;
      if (!isIgnored(entry, checkId)) {
        results.push(
          check(Severity.INFO, checkId, `Optional overlay ${file} missing for type "${entry.type}"`, true),
        );
      }
    }
  }

  // Capsule version behind
  if (entry.capsuleVersion < CAPSULE_VERSION) {
    if (!isIgnored(entry, 'capsuleVersionBehind')) {
      results.push(
        check(
          Severity.INFO,
          'capsuleVersionBehind',
          `Capsule version ${entry.capsuleVersion} is behind current ${CAPSULE_VERSION}. Will auto-upgrade on next command.`,
          false,
        ),
      );
    }
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
    if (!isIgnored(entry, 'lastDoneMissing')) {
      results.push(
        check(Severity.ERROR, 'lastDoneMissing', 'STATUS.md missing "Last done (UTC)" section', true),
      );
    }
  } else {
    // Check for timestamp in the section
    const lastDoneIndex = statusContent.search(LAST_DONE_RE);
    const sectionAfter = statusContent.slice(lastDoneIndex);
    const nextSectionIndex = sectionAfter.indexOf('\n## ', 1);
    const lastDoneSection = nextSectionIndex > 0
      ? sectionAfter.slice(0, nextSectionIndex)
      : sectionAfter;

    if (!TIMESTAMP_RE.test(lastDoneSection)) {
      if (!isIgnored(entry, 'lastDoneNoTimestamp')) {
        results.push(
          check(Severity.ERROR, 'lastDoneNoTimestamp', 'STATUS.md "Last done" section has no timestamp', true),
        );
      }
    } else if (entry.status === 'active') {
      // Check timestamp age (default: 3 days)
      const tsMatch = lastDoneSection.match(TIMESTAMP_RE);
      if (tsMatch) {
        const ts = new Date(tsMatch[0]);
        const ageDays = (Date.now() - ts.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > 3) {
          if (!isIgnored(entry, 'lastDoneStale')) {
            results.push(
              check(
                Severity.WARN,
                'lastDoneStale',
                `STATUS.md "Last done" timestamp is ${Math.floor(ageDays)} days old`,
                false,
              ),
            );
          }
        }
      }
    }
  }

  // "Next actions (now)" section check
  if (!NEXT_ACTIONS_RE.test(statusContent)) {
    if (!isIgnored(entry, 'nextActionsMissing')) {
      results.push(
        check(Severity.ERROR, 'nextActionsMissing', 'STATUS.md missing "Next actions (now)" section', true),
      );
    }
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
      if (!isIgnored(entry, 'nextActionsEmpty')) {
        results.push(
          check(
            Severity.WARN,
            'nextActionsEmpty',
            '"Next actions (now)" has no task IDs or entries',
            false,
          ),
        );
      }
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
        `${missing.length} task IDs in "Next actions (now)" not found in TODO.md: ${missing.join(', ')}`,
        false,
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
      if (!isIgnored(entry, 'commandsEmpty')) {
        results.push(
          check(Severity.INFO, 'commandsEmpty', 'COMMANDS.md is empty for a coding topic', false),
        );
      }
    }
  }

  // LINKS.md empty for coding or research
  if (entry.type === 'coding' || entry.type === 'research') {
    const linksContent = capsuleFiles.get('LINKS.md');
    if (linksContent !== undefined && isEffectivelyEmpty(linksContent)) {
      if (!isIgnored(entry, 'linksEmpty')) {
        results.push(
          check(Severity.INFO, 'linksEmpty', 'LINKS.md is empty for a coding/research topic', false),
        );
      }
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
      check(Severity.WARN, 'cronNoJobIds', 'CRON.md lists jobs but has no recognizable job IDs', false),
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
              `Job ID "${match[0]}" from CRON.md not found in cron/jobs.json`,
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
    if (!isIgnored(entry, 'configGroupMissing')) {
      results.push(
        check(Severity.WARN, 'configGroupMissing', `Group ${entry.groupId} missing from generated include`, false),
      );
    }
    return results;
  }

  const topics = groupConfig['topics'] as Record<string, unknown> | undefined;
  const topicConfig = topics?.[entry.threadId] as Record<string, unknown> | undefined;

  if (!topicConfig) {
    if (!isIgnored(entry, 'configTopicMissing')) {
      results.push(
        check(Severity.WARN, 'configTopicMissing', `Topic config missing for thread ${entry.threadId}`, false),
      );
    }
    return results;
  }

  // Check systemPrompt exists
  if (!topicConfig['systemPrompt']) {
    if (!isIgnored(entry, 'configNoSystemPrompt')) {
      results.push(
        check(Severity.WARN, 'configNoSystemPrompt', 'Per-topic systemPrompt is missing in generated include', false),
      );
    }
  }

  // Check skills exist
  if (!topicConfig['skills'] || !Array.isArray(topicConfig['skills'])) {
    if (!isIgnored(entry, 'configNoSkills')) {
      results.push(
        check(Severity.WARN, 'configNoSkills', 'Per-topic skills list is missing in generated include', false),
      );
    }
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
        'Generated include file has no registry-hash comment. Run /tm sync.',
        false,
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
        'Generated include is out of sync with registry. Run /tm sync.',
        false,
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
        `${entry.consecutiveSilentDoctors} consecutive doctor reports with no user interaction. Auto-snoozing for 30 days.`,
        true,
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
    if (todoContent && !isIgnored(entry, 'nextNotInTodo')) {
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
