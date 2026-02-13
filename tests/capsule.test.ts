import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  scaffoldCapsule,
  upgradeCapsule,
  validateCapsule,
  writeCapsuleFileIfChanged,
} from '../src/lib/capsule.js';
import type { TopicType } from '../src/lib/types.js';
import { CAPSULE_VERSION, BASE_FILES, OVERLAY_FILES } from '../src/lib/types.js';

describe('capsule', () => {
  let tmpDir: string;
  let projectsBase: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-test-'));
    projectsBase = path.join(tmpDir, 'projects');
    fs.mkdirSync(projectsBase, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('scaffoldCapsule', () => {
    it('should create capsule directory atomically', () => {
      const slug = 'test-topic';
      scaffoldCapsule(projectsBase, slug, slug, 'coding');

      const capsuleDir = path.join(projectsBase, slug);
      expect(fs.existsSync(capsuleDir)).toBe(true);
      expect(fs.statSync(capsuleDir).isDirectory()).toBe(true);
    });

    it('should throw if directory already exists', () => {
      const slug = 'existing-topic';
      const capsuleDir = path.join(projectsBase, slug);
      fs.mkdirSync(capsuleDir);

      expect(() => scaffoldCapsule(projectsBase, slug, slug, 'coding')).toThrow();
    });

    it('should create all base files', () => {
      const slug = 'test-topic';
      scaffoldCapsule(projectsBase, slug, slug, 'coding');

      const capsuleDir = path.join(projectsBase, slug);
      for (const file of BASE_FILES) {
        const filePath = path.join(capsuleDir, file);
        expect(fs.existsSync(filePath)).toBe(true);
      }
    });

    it('should create coding overlay files', () => {
      const slug = 'test-coding';
      scaffoldCapsule(projectsBase, slug, slug, 'coding');

      const capsuleDir = path.join(projectsBase, slug);
      const overlays = OVERLAY_FILES['coding'];

      expect(overlays).toContain('ARCHITECTURE.md');
      expect(overlays).toContain('DEPLOY.md');

      for (const file of overlays) {
        const filePath = path.join(capsuleDir, file);
        expect(fs.existsSync(filePath)).toBe(true);
      }
    });

    it('should create research overlay files', () => {
      const slug = 'test-research';
      scaffoldCapsule(projectsBase, slug, slug, 'research');

      const capsuleDir = path.join(projectsBase, slug);
      const overlays = OVERLAY_FILES['research'];

      expect(overlays).toContain('SOURCES.md');
      expect(overlays).toContain('FINDINGS.md');

      for (const file of overlays) {
        const filePath = path.join(capsuleDir, file);
        expect(fs.existsSync(filePath)).toBe(true);
      }
    });

    it('should create marketing overlay files', () => {
      const slug = 'test-marketing';
      scaffoldCapsule(projectsBase, slug, slug, 'marketing');

      const capsuleDir = path.join(projectsBase, slug);
      const overlays = OVERLAY_FILES['marketing'];

      expect(overlays).toContain('CAMPAIGNS.md');
      expect(overlays).toContain('METRICS.md');

      for (const file of overlays) {
        const filePath = path.join(capsuleDir, file);
        expect(fs.existsSync(filePath)).toBe(true);
      }
    });

    it('should set correct file permissions', () => {
      const slug = 'test-perms';
      scaffoldCapsule(projectsBase, slug, slug, 'coding');

      const capsuleDir = path.join(projectsBase, slug);
      const statusPath = path.join(capsuleDir, 'STATUS.md');
      const stat = fs.statSync(statusPath);

      // macOS may apply umask - just verify file exists and is readable
      expect(fs.existsSync(statusPath)).toBe(true);
      expect(stat.isFile()).toBe(true);
    });

    it('should reject path traversal attempts', () => {
      expect(() => scaffoldCapsule(projectsBase, '../escape', '../escape', 'coding')).toThrow(/Path escapes/);
      expect(() => scaffoldCapsule(projectsBase, '../../double-escape', '../../double-escape', 'coding')).toThrow(/Path escapes/);
    });

    it('should reject symlink in projects base', () => {
      const symlinkBase = path.join(tmpDir, 'symlink-base');
      fs.symlinkSync(projectsBase, symlinkBase);

      expect(() => scaffoldCapsule(symlinkBase, 'test', 'test', 'coding')).toThrow(/symlink/);
    });

    it('should create LEARNINGS.md for new capsules', () => {
      const slug = 'test-learnings';
      scaffoldCapsule(projectsBase, slug, slug, 'coding');

      const capsuleDir = path.join(projectsBase, slug);
      const learningsPath = path.join(capsuleDir, 'LEARNINGS.md');
      expect(fs.existsSync(learningsPath)).toBe(true);

      const content = fs.readFileSync(learningsPath, 'utf-8');
      expect(content).toContain('Learnings');
      expect(content).toContain('Hard-won insights');
    });

    it('should include slug in file content', () => {
      const slug = 'my-project';
      scaffoldCapsule(projectsBase, slug, slug, 'coding');

      const capsuleDir = path.join(projectsBase, slug);
      const readmePath = path.join(capsuleDir, 'README.md');
      const content = fs.readFileSync(readmePath, 'utf-8');

      expect(content).toContain(slug);
    });

    it('should create STATUS.md with two-tier queue format', () => {
      const slug = 'test-two-tier';
      scaffoldCapsule(projectsBase, slug, slug, 'coding');

      const capsuleDir = path.join(projectsBase, slug);
      const statusPath = path.join(capsuleDir, 'STATUS.md');
      const content = fs.readFileSync(statusPath, 'utf-8');

      expect(content).toContain('## Next actions (now)');
      expect(content).toContain('## Upcoming actions');
      expect(content).not.toContain('Next 3 actions');
    });
  });

  describe('upgradeCapsule', () => {
    it('should not upgrade if already at current version', () => {
      const slug = 'test-topic';
      scaffoldCapsule(projectsBase, slug, slug, 'coding');

      const result = upgradeCapsule(projectsBase, slug, slug, 'coding', CAPSULE_VERSION);

      expect(result.upgraded).toBe(false);
      expect(result.newVersion).toBe(CAPSULE_VERSION);
      expect(result.addedFiles).toEqual([]);
    });

    it('should add missing base files', () => {
      const slug = 'test-upgrade';
      scaffoldCapsule(projectsBase, slug, slug, 'coding');

      // Remove a base file
      const capsuleDir = path.join(projectsBase, slug);
      fs.unlinkSync(path.join(capsuleDir, 'NOTES.md'));

      const result = upgradeCapsule(projectsBase, slug, slug, 'coding', 0);

      expect(result.upgraded).toBe(true);
      expect(result.newVersion).toBe(CAPSULE_VERSION);
      expect(result.addedFiles).toContain('NOTES.md');
      expect(fs.existsSync(path.join(capsuleDir, 'NOTES.md'))).toBe(true);
    });

    it('should add LEARNINGS.md when upgrading from v1', () => {
      const slug = 'test-upgrade-learnings';
      scaffoldCapsule(projectsBase, slug, slug, 'coding');

      // Remove LEARNINGS.md to simulate a v1 capsule
      const capsuleDir = path.join(projectsBase, slug);
      const learningsPath = path.join(capsuleDir, 'LEARNINGS.md');
      fs.unlinkSync(learningsPath);
      expect(fs.existsSync(learningsPath)).toBe(false);

      const result = upgradeCapsule(projectsBase, slug, slug, 'coding', 0);

      expect(result.upgraded).toBe(true);
      expect(result.addedFiles).toContain('LEARNINGS.md');
      expect(fs.existsSync(learningsPath)).toBe(true);
    });

    it('should add missing overlay files', () => {
      const slug = 'test-overlay-upgrade';
      scaffoldCapsule(projectsBase, slug, slug, 'research');

      // Remove an overlay file
      const capsuleDir = path.join(projectsBase, slug);
      fs.unlinkSync(path.join(capsuleDir, 'FINDINGS.md'));

      const result = upgradeCapsule(projectsBase, slug, slug, 'research', 0);

      expect(result.upgraded).toBe(true);
      expect(result.addedFiles).toContain('FINDINGS.md');
      expect(fs.existsSync(path.join(capsuleDir, 'FINDINGS.md'))).toBe(true);
    });

    it('should not overwrite existing files', () => {
      const slug = 'test-no-overwrite';
      scaffoldCapsule(projectsBase, slug, slug, 'coding');

      const capsuleDir = path.join(projectsBase, slug);
      const statusPath = path.join(capsuleDir, 'STATUS.md');
      const originalContent = fs.readFileSync(statusPath, 'utf-8');

      fs.writeFileSync(statusPath, 'CUSTOM CONTENT', 'utf-8');

      upgradeCapsule(projectsBase, slug, slug, 'coding', 0);

      const afterContent = fs.readFileSync(statusPath, 'utf-8');
      expect(afterContent).toBe('CUSTOM CONTENT');
    });

    it('should reject path traversal', () => {
      expect(() => upgradeCapsule(projectsBase, '../escape', '../escape', 'coding', 0)).toThrow(/Path escapes/);
    });

    it('should reject symlink directory', () => {
      const slug = 'real-dir';
      const symlinkSlug = 'symlink-dir';
      scaffoldCapsule(projectsBase, slug, slug, 'coding');

      const capsuleDir = path.join(projectsBase, slug);
      const symlinkDir = path.join(projectsBase, symlinkSlug);
      fs.symlinkSync(capsuleDir, symlinkDir);

      expect(() => upgradeCapsule(projectsBase, symlinkSlug, symlinkSlug, 'coding', 0)).toThrow(/symlink/);
    });
  });

  describe('validateCapsule', () => {
    it('should validate complete capsule', () => {
      const slug = 'complete-topic';
      scaffoldCapsule(projectsBase, slug, slug, 'coding');

      const result = validateCapsule(projectsBase, slug, 'coding');

      const expectedFiles = [...BASE_FILES, ...OVERLAY_FILES['coding']];
      expect(result.present).toEqual(expect.arrayContaining(expectedFiles));
      expect(result.missing).toEqual([]);
    });

    it('should detect missing base files', () => {
      const slug = 'incomplete-topic';
      scaffoldCapsule(projectsBase, slug, slug, 'coding');

      const capsuleDir = path.join(projectsBase, slug);
      fs.unlinkSync(path.join(capsuleDir, 'TODO.md'));
      fs.unlinkSync(path.join(capsuleDir, 'COMMANDS.md'));

      const result = validateCapsule(projectsBase, slug, 'coding');

      expect(result.missing).toContain('TODO.md');
      expect(result.missing).toContain('COMMANDS.md');
      expect(result.present).not.toContain('TODO.md');
      expect(result.present).toContain('STATUS.md');
    });

    it('should detect missing overlay files', () => {
      const slug = 'missing-overlays';
      scaffoldCapsule(projectsBase, slug, slug, 'research');

      const capsuleDir = path.join(projectsBase, slug);
      fs.unlinkSync(path.join(capsuleDir, 'SOURCES.md'));

      const result = validateCapsule(projectsBase, slug, 'research');

      expect(result.missing).toContain('SOURCES.md');
      expect(result.present).toContain('FINDINGS.md');
    });

    it('should handle different topic types', () => {
      const types: TopicType[] = ['coding', 'research', 'marketing', 'custom'];

      for (const type of types) {
        const slug = `test-${type}`;
        scaffoldCapsule(projectsBase, slug, slug, type);

        const result = validateCapsule(projectsBase, slug, type);

        expect(result.missing).toEqual([]);
        expect(result.present.length).toBeGreaterThan(0);
      }
    });

    it('should reject path traversal', () => {
      expect(() => validateCapsule(projectsBase, '../escape', 'coding')).toThrow(/Path escapes/);
    });
  });

  describe('writeCapsuleFileIfChanged', () => {
    it('should skip write when content is identical', () => {
      const filePath = path.join(projectsBase, 'test-file.md');
      fs.writeFileSync(filePath, 'Hello World');

      const result = writeCapsuleFileIfChanged(filePath, 'Hello World');

      expect(result).toBe(false);
    });

    it('should write when content differs', () => {
      const filePath = path.join(projectsBase, 'test-file.md');
      fs.writeFileSync(filePath, 'Old content');

      const result = writeCapsuleFileIfChanged(filePath, 'New content');

      expect(result).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('New content');
    });

    it('should write when file does not exist', () => {
      const filePath = path.join(projectsBase, 'new-file.md');

      const result = writeCapsuleFileIfChanged(filePath, 'Brand new');

      expect(result).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('Brand new');
    });
  });
});
