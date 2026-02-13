import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import JSON5 from 'json5';
import type { Registry, TopicEntry, TopicType } from './types.js';

// ── Constants ──────────────────────────────────────────────────────────

const INCLUDE_FILENAME = 'telegram-manager.generated.groups.json5';
const FILE_MODE = 0o600;

// ── System prompt template ─────────────────────────────────────────────

/**
 * Build the per-topic systemPrompt using absolute paths resolved at generation time.
 *
 * @param name - human-readable display label for identity
 * @param slug - stable ID used for topic folder path
 */
export function getSystemPromptTemplate(name: string, slug: string, absoluteWorkspacePath: string): string {
  return `You are the assistant for the Telegram topic: ${name}.

Determinism rules:
- Source of truth is the project folder at: ${absoluteWorkspacePath}/projects/${slug}/
- After /reset, /new, or context compaction: ALWAYS re-read STATUS.md,
  then TODO.md, then LEARNINGS.md (last 20 entries), then COMMANDS.md
  before continuing work. Do not rely on summarized memory for paths,
  commands, or task state.
- Before context compaction or when the conversation is long: proactively
  flush current progress to STATUS.md (update "Last done (UTC)" and
  "Next actions (now)") so compaction cannot erase critical state.
  Use the standard file write tool directly — do not route through /tm.
- Keep STATUS.md accurate: always maintain "Last done (UTC)", "Next actions (now)",
  and "Upcoming actions".
- When new commands appear, add them to COMMANDS.md (don't leave them only in chat).
- When new links/paths/services appear, add them to LINKS.md.
- If automation/cron is involved, record job IDs + schedules in CRON.md.
- Task IDs (e.g., [T-1]) must stay consistent between STATUS.md and TODO.md.
- STATUS.md has two priority sections: "Next actions (now)" for immediate work
  and "Upcoming actions" for the near-future pipeline.

Learning capture:
- When you discover something unexpected, a mistake, a workaround, or a
  constraint — prepend a dated entry to LEARNINGS.md.
- Format: ## YYYY-MM-DD\\n- source: (chat/debug/research)\\n- insight text
- Most recent first (prepend after the header, before existing entries).
- Only write when a genuinely new insight exists — avoid restating known facts.
- If LEARNINGS.md exceeds ~200 lines, archive older entries to LEARNINGS-archive.md.

Separation:
- Your workspace is strictly projects/${slug}/. Do not read, write, or reference
  files in any other topic's project directory.
- If the user mentions another topic by name or slug, ask for explicit
  confirmation before mixing work: "This references topic X — switch context?"
- Never copy data between topic folders without explicit user instruction.
- Ask one clarifying question if the next action is ambiguous.`;
}

// ── Registry hash ──────────────────────────────────────────────────────

/**
 * Compute a SHA256 hash of the registry topics for drift detection.
 */
export function computeRegistryHash(topics: Registry['topics']): string {
  const content = JSON.stringify(topics);
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ── Build include object ───────────────────────────────────────────────

/**
 * Build the JavaScript object for the generated include file.
 * Groups topics by groupId, with each topic's config under its threadId.
 */
export function buildIncludeObject(
  registry: Registry,
  workspaceDir: string,
  existingInclude?: Record<string, unknown> | null,
): Record<string, unknown> {
  const absoluteWorkspacePath = path.resolve(workspaceDir);
  const groups: Record<string, Record<string, unknown>> = {};

  // Preserve group-level settings (e.g. requireMention) from existing include
  if (existingInclude) {
    for (const [groupId, groupVal] of Object.entries(existingInclude)) {
      if (groupVal && typeof groupVal === 'object') {
        const preserved: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(groupVal as Record<string, unknown>)) {
          if (key !== 'topics') {
            preserved[key] = val;
          }
        }
        if (Object.keys(preserved).length > 0) {
          groups[groupId] = { ...preserved, topics: {} };
        }
      }
    }
  }

  for (const entry of Object.values(registry.topics)) {
    const { groupId, threadId, slug, name, type, status } = entry;

    if (!groups[groupId]) {
      groups[groupId] = { topics: {} };
    }
    if (!groups[groupId].topics) {
      groups[groupId].topics = {};
    }

    const isEnabled = status !== 'archived';
    const skills = getSkillsForType(type);
    const systemPrompt = getSystemPromptTemplate(name, slug, absoluteWorkspacePath);

    (groups[groupId].topics as Record<string, unknown>)[threadId] = {
      enabled: isEnabled,
      skills,
      systemPrompt,
    };
  }

  return groups;
}

/**
 * Get the default skills list for a topic type.
 */
function getSkillsForType(type: TopicType): string[] {
  switch (type) {
    case 'coding':
      return ['coding-agent'];
    case 'research':
      return ['research-agent'];
    case 'marketing':
      return ['marketing-agent'];
    default:
      return [];
  }
}

// ── Generate include file ──────────────────────────────────────────────

/**
 * Generate the JSON5 include file from the registry.
 *
 * Steps:
 * 1. Build JS object from registry entries
 * 2. Serialize via JSON5.stringify (never string interpolation)
 * 3. Parse back to verify round-trip integrity
 * 4. Atomic write with .bak
 * 5. Prepend registry-hash comment
 */
export function generateInclude(
  workspaceDir: string,
  registry: Registry,
  configDir: string,
): void {
  // Read existing include file to preserve group-level settings
  let existingInclude: Record<string, unknown> | null = null;
  const existingPath = path.join(configDir, INCLUDE_FILENAME);
  if (fs.existsSync(existingPath)) {
    try {
      const raw = fs.readFileSync(existingPath, 'utf-8');
      existingInclude = JSON5.parse(raw) as Record<string, unknown>;
    } catch {
      // If we can't parse it, proceed without existing data
    }
  }

  const includeObj = buildIncludeObject(registry, workspaceDir, existingInclude);
  const hash = computeRegistryHash(registry.topics);

  // Serialize via JSON5.stringify
  const json5Content = JSON5.stringify(includeObj, null, 2);

  // Round-trip validation: parse back to verify integrity
  try {
    JSON5.parse(json5Content);
  } catch (err) {
    throw new Error(
      `Include generation failed: round-trip validation error. ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Build final content with header comment
  const header = [
    '// This file is generated by telegram-manager. Do not hand-edit.',
    `// Rebuild from: ${path.resolve(workspaceDir)}/projects/topics.json`,
    `// registry-hash: sha256:${hash}`,
  ].join('\n');

  const finalContent = header + '\n' + json5Content + '\n';

  // Atomic write
  const includePath = path.join(configDir, INCLUDE_FILENAME);
  const tmpPath = includePath + '.tmp';
  const bakPath = includePath + '.bak';

  // Backup existing file if it exists
  if (fs.existsSync(includePath)) {
    fs.copyFileSync(includePath, bakPath);
    fs.chmodSync(bakPath, FILE_MODE);
  }

  // Write to tmp then rename (atomic on POSIX)
  fs.writeFileSync(tmpPath, finalContent, { mode: FILE_MODE });
  fs.renameSync(tmpPath, includePath);
  fs.chmodSync(includePath, FILE_MODE);
}

// ── Extract registry hash from include file ────────────────────────────

/**
 * Extract the registry-hash from an existing include file's content.
 * Returns the hash string or null if not found.
 */
export function extractRegistryHash(includeContent: string): string | null {
  const match = includeContent.match(/^\/\/ registry-hash: sha256:([a-f0-9]+)$/m);
  return match?.[1] ?? null;
}

/**
 * Get the path to the generated include file.
 */
export function includePath(configDir: string): string {
  return path.join(configDir, INCLUDE_FILENAME);
}
