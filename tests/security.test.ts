import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  validateSlug,
  sanitizeSlug,
  jailCheck,
  rejectSymlink,
  hmacSign,
  hmacVerify,
  htmlEscape,
  validateGroupId,
  validateThreadId,
  buildCallbackData,
  parseAndVerifyCallback,
} from '../src/lib/security.js';

describe('security', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('validateSlug', () => {
    it('should accept valid slugs', () => {
      expect(validateSlug('valid-slug')).toBe(true);
      expect(validateSlug('a')).toBe(true);
      expect(validateSlug('test123')).toBe(true);
      expect(validateSlug('my-project-name')).toBe(true);
      expect(validateSlug('t-123')).toBe(true);
    });

    it('should reject invalid slugs', () => {
      expect(validateSlug('UPPERCASE')).toBe(false);
      expect(validateSlug('has spaces')).toBe(false);
      expect(validateSlug('has_underscores')).toBe(false);
      expect(validateSlug('123-starts-with-number')).toBe(false);
      expect(validateSlug('-starts-with-hyphen')).toBe(false);
      expect(validateSlug('has.dots')).toBe(false);
      expect(validateSlug('')).toBe(false);
      expect(validateSlug('a'.repeat(51))).toBe(false); // Too long
    });

    it('should enforce max length of 50 chars', () => {
      expect(validateSlug('a'.repeat(50))).toBe(true);
      expect(validateSlug('a'.repeat(51))).toBe(false);
    });
  });

  describe('sanitizeSlug', () => {
    it('should convert to lowercase', () => {
      expect(sanitizeSlug('UPPERCASE')).toBe('uppercase');
      expect(sanitizeSlug('MixedCase')).toBe('mixedcase');
    });

    it('should replace spaces with hyphens', () => {
      expect(sanitizeSlug('my project name')).toBe('my-project-name');
    });

    it('should strip dots', () => {
      expect(sanitizeSlug('test.file.name')).toBe('testfilename');
    });

    it('should replace special chars with hyphens', () => {
      expect(sanitizeSlug('test@project#name')).toBe('test-project-name');
      expect(sanitizeSlug('my_project_name')).toBe('my-project-name');
    });

    it('should collapse consecutive hyphens', () => {
      expect(sanitizeSlug('test---name')).toBe('test-name');
      expect(sanitizeSlug('a--b--c')).toBe('a-b-c');
    });

    it('should trim leading and trailing hyphens', () => {
      expect(sanitizeSlug('-test-')).toBe('test');
      expect(sanitizeSlug('---test---')).toBe('test');
    });

    it('should enforce max length', () => {
      const long = 'a'.repeat(100);
      expect(sanitizeSlug(long)).toHaveLength(50);
    });

    it('should handle complex inputs', () => {
      // Dots are stripped, so 2.0 becomes 20
      expect(sanitizeSlug('My Project (v2.0) - Final!')).toBe('my-project-v20-final');
    });
  });

  describe('jailCheck', () => {
    it('should allow safe paths', () => {
      expect(jailCheck(tmpDir, 'subdir')).toBe(true);
      expect(jailCheck(tmpDir, 'subdir/file.txt')).toBe(true);
      expect(jailCheck(tmpDir, 'a/b/c')).toBe(true);
    });

    it('should reject path traversal attempts', () => {
      expect(jailCheck(tmpDir, '../escape')).toBe(false);
      expect(jailCheck(tmpDir, '../../escape')).toBe(false);
      expect(jailCheck(tmpDir, 'subdir/../../escape')).toBe(false);
    });

    it('should handle absolute paths correctly', () => {
      const safePath = path.join(tmpDir, 'subdir');
      expect(jailCheck(tmpDir, safePath)).toBe(true);

      const unsafePath = '/etc/passwd';
      expect(jailCheck(tmpDir, unsafePath)).toBe(false);
    });

    it('should allow same directory', () => {
      expect(jailCheck(tmpDir, '.')).toBe(true);
      expect(jailCheck(tmpDir, '')).toBe(true);
    });
  });

  describe('rejectSymlink', () => {
    it('should return false for regular files', () => {
      const file = path.join(tmpDir, 'regular.txt');
      fs.writeFileSync(file, 'content');

      expect(rejectSymlink(file)).toBe(false);
    });

    it('should return false for directories', () => {
      const dir = path.join(tmpDir, 'dir');
      fs.mkdirSync(dir);

      expect(rejectSymlink(dir)).toBe(false);
    });

    it('should return true for symlinks', () => {
      const target = path.join(tmpDir, 'target.txt');
      const link = path.join(tmpDir, 'link.txt');
      fs.writeFileSync(target, 'content');
      fs.symlinkSync(target, link);

      expect(rejectSymlink(link)).toBe(true);
    });

    it('should return false for non-existent paths', () => {
      expect(rejectSymlink('/nonexistent/path')).toBe(false);
    });
  });

  describe('HMAC signing and verification', () => {
    const secret = 'test-secret-key';

    it('should sign payload consistently', () => {
      const payload = 'test-payload';
      const sig1 = hmacSign(secret, payload);
      const sig2 = hmacSign(secret, payload);

      expect(sig1).toBe(sig2);
      expect(sig1).toHaveLength(16);
    });

    it('should verify valid signature', () => {
      const payload = 'test-payload';
      const signature = hmacSign(secret, payload);

      expect(hmacVerify(secret, payload, signature)).toBe(true);
    });

    it('should reject invalid signature', () => {
      const payload = 'test-payload';
      const wrongSignature = 'invalid-signature';

      expect(hmacVerify(secret, payload, wrongSignature)).toBe(false);
    });

    it('should reject tampered payload', () => {
      const payload = 'original-payload';
      const signature = hmacSign(secret, payload);

      expect(hmacVerify(secret, 'tampered-payload', signature)).toBe(false);
    });

    it('should reject signature with wrong secret', () => {
      const payload = 'test-payload';
      const signature = hmacSign(secret, payload);

      expect(hmacVerify('wrong-secret', payload, signature)).toBe(false);
    });

    it('should use constant-time comparison', () => {
      const payload = 'test-payload';
      const signature = hmacSign(secret, payload);

      // Signature length mismatch should return false without timing leak
      expect(hmacVerify(secret, payload, signature + 'x')).toBe(false);
    });
  });

  describe('htmlEscape', () => {
    it('should escape HTML special characters', () => {
      expect(htmlEscape('<script>')).toBe('&lt;script&gt;');
      expect(htmlEscape('A & B')).toBe('A &amp; B');
      expect(htmlEscape('"quotes"')).toBe('&quot;quotes&quot;');
    });

    it('should handle mixed content', () => {
      expect(htmlEscape('<div class="test">A & B</div>'))
        .toBe('&lt;div class=&quot;test&quot;&gt;A &amp; B&lt;/div&gt;');
    });

    it('should leave safe text unchanged', () => {
      expect(htmlEscape('safe text 123')).toBe('safe text 123');
    });
  });

  describe('ID validation', () => {
    describe('validateGroupId', () => {
      it('should accept valid group IDs', () => {
        expect(validateGroupId('-100123456789')).toBe(true);
        expect(validateGroupId('123456')).toBe(true);
        expect(validateGroupId('-999')).toBe(true);
        expect(validateGroupId('0')).toBe(true);
      });

      it('should reject invalid group IDs', () => {
        expect(validateGroupId('abc')).toBe(false);
        expect(validateGroupId('12.34')).toBe(false);
        expect(validateGroupId('12a34')).toBe(false);
        expect(validateGroupId('')).toBe(false);
        expect(validateGroupId('--123')).toBe(false);
      });
    });

    describe('validateThreadId', () => {
      it('should accept valid thread IDs', () => {
        expect(validateThreadId('123')).toBe(true);
        expect(validateThreadId('0')).toBe(true);
        expect(validateThreadId('999999')).toBe(true);
      });

      it('should reject invalid thread IDs', () => {
        expect(validateThreadId('-123')).toBe(false);
        expect(validateThreadId('abc')).toBe(false);
        expect(validateThreadId('12.34')).toBe(false);
        expect(validateThreadId('')).toBe(false);
      });
    });
  });

  describe('callback data handling', () => {
    const secret = 'test-callback-secret';
    const action = 'snooze';
    const slug = 'test-topic';
    const groupId = '-100123';
    const threadId = '456';

    it('should build valid callback data', () => {
      const data = buildCallbackData(action, slug, groupId, threadId, secret);

      expect(data).toMatch(/^tm:snooze:test-topic:-100123:456:[a-f0-9]+$/);
    });

    it('should parse and verify valid callback data', () => {
      const data = buildCallbackData(action, slug, groupId, threadId, secret);
      const result = parseAndVerifyCallback(data, secret, groupId, threadId);

      expect(result).not.toBeNull();
      expect(result?.action).toBe(action);
      expect(result?.slug).toBe(slug);
      expect(result?.groupId).toBe(groupId);
      expect(result?.threadId).toBe(threadId);
    });

    it('should reject callback with invalid format', () => {
      const result = parseAndVerifyCallback('invalid-format', secret, groupId, threadId);
      expect(result).toBeNull();
    });

    it('should reject callback with wrong HMAC', () => {
      const data = 'tm:snooze:test-topic:-100123:456:wronghmac123';
      const result = parseAndVerifyCallback(data, secret, groupId, threadId);

      expect(result).toBeNull();
    });

    it('should reject callback with wrong secret', () => {
      const data = buildCallbackData(action, slug, groupId, threadId, secret);
      const result = parseAndVerifyCallback(data, 'wrong-secret', groupId, threadId);

      expect(result).toBeNull();
    });

    it('should reject callback with mismatched context', () => {
      const data = buildCallbackData(action, slug, groupId, threadId, secret);

      // Wrong groupId
      expect(parseAndVerifyCallback(data, secret, '-999', threadId)).toBeNull();

      // Wrong threadId
      expect(parseAndVerifyCallback(data, secret, groupId, '999')).toBeNull();
    });

    it('should prevent cross-topic tampering', () => {
      const data = buildCallbackData(action, slug, groupId, threadId, secret);

      // Try to use callback from different topic
      const result = parseAndVerifyCallback(data, secret, '-100999', '789');

      expect(result).toBeNull();
    });
  });
});
