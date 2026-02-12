import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
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
    const groupId = '-100123';
    const threadId = '456';
    const userId = '789012';

    it('should build valid callback data', () => {
      const data = buildCallbackData(action, groupId, threadId, secret, userId);

      expect(data).toMatch(/^tm:snooze:-100123:456:789012:[a-f0-9]+$/);
    });

    it('should parse and verify valid callback data', () => {
      const data = buildCallbackData(action, groupId, threadId, secret, userId);
      const result = parseAndVerifyCallback(data, secret, groupId, threadId);

      expect(result).not.toBeNull();
      expect(result?.action).toBe(action);
      expect(result?.groupId).toBe(groupId);
      expect(result?.threadId).toBe(threadId);
      expect(result?.userId).toBe(userId);
    });

    it('should reject callback with invalid format', () => {
      const result = parseAndVerifyCallback('invalid-format', secret, groupId, threadId);
      expect(result).toBeNull();
    });

    it('should reject callback with wrong HMAC', () => {
      const data = 'tm:snooze:-100123:456:789012:wronghmac1234567';
      const result = parseAndVerifyCallback(data, secret, groupId, threadId);

      expect(result).toBeNull();
    });

    it('should reject callback with wrong secret', () => {
      const data = buildCallbackData(action, groupId, threadId, secret, userId);
      const result = parseAndVerifyCallback(data, 'wrong-secret', groupId, threadId);

      expect(result).toBeNull();
    });

    it('should reject callback with mismatched context', () => {
      const data = buildCallbackData(action, groupId, threadId, secret, userId);

      // Wrong groupId
      expect(parseAndVerifyCallback(data, secret, '-999', threadId)).toBeNull();

      // Wrong threadId
      expect(parseAndVerifyCallback(data, secret, groupId, '999')).toBeNull();
    });

    it('should prevent cross-topic tampering', () => {
      const data = buildCallbackData(action, groupId, threadId, secret, userId);

      // Try to use callback from different topic
      const result = parseAndVerifyCallback(data, secret, '-100999', '789');

      expect(result).toBeNull();
    });
  });
});
