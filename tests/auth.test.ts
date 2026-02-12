import { describe, it, expect } from 'vitest';
import { AuthTier, getCommandTier, checkAuthorization } from '../src/lib/auth.js';
import { createEmptyRegistry } from '../src/lib/registry.js';
import type { Registry } from '../src/lib/types.js';

describe('auth', () => {
  describe('getCommandTier', () => {
    it('should classify user-tier commands', () => {
      expect(getCommandTier('init')).toBe(AuthTier.User);
      expect(getCommandTier('doctor')).toBe(AuthTier.User);
      expect(getCommandTier('status')).toBe(AuthTier.User);
      expect(getCommandTier('help')).toBe(AuthTier.User);
      expect(getCommandTier('upgrade')).toBe(AuthTier.User);
      expect(getCommandTier('snooze')).toBe(AuthTier.User);
    });

    it('should classify admin-tier commands', () => {
      expect(getCommandTier('doctor --all')).toBe(AuthTier.Admin);
      expect(getCommandTier('doctor-all')).toBe(AuthTier.Admin);
      expect(getCommandTier('list')).toBe(AuthTier.Admin);
      expect(getCommandTier('sync')).toBe(AuthTier.Admin);
      expect(getCommandTier('rename')).toBe(AuthTier.Admin);
      expect(getCommandTier('archive')).toBe(AuthTier.Admin);
      expect(getCommandTier('unarchive')).toBe(AuthTier.Admin);
    });

    it('should handle case insensitivity', () => {
      expect(getCommandTier('INIT')).toBe(AuthTier.User);
      expect(getCommandTier('List')).toBe(AuthTier.Admin);
    });

    it('should default unknown commands to admin tier', () => {
      expect(getCommandTier('unknown-command')).toBe(AuthTier.Admin);
      expect(getCommandTier('custom')).toBe(AuthTier.Admin);
    });

    it('should trim whitespace', () => {
      expect(getCommandTier('  init  ')).toBe(AuthTier.User);
      expect(getCommandTier('  list  ')).toBe(AuthTier.Admin);
    });
  });

  describe('checkAuthorization', () => {
    let registry: Registry;

    beforeEach(() => {
      registry = createEmptyRegistry('secret');
    });

    describe('first-user bootstrap', () => {
      it('should allow anyone to run init when no admins set', () => {
        expect(registry.topicManagerAdmins).toEqual([]);

        const result = checkAuthorization('user123', 'init', registry);

        expect(result.authorized).toBe(true);
        expect(result.message).toBeUndefined();
      });

      it('should allow user-tier commands during bootstrap', () => {
        expect(registry.topicManagerAdmins).toEqual([]);

        expect(checkAuthorization('user123', 'status', registry).authorized).toBe(true);
        expect(checkAuthorization('user123', 'help', registry).authorized).toBe(true);
        expect(checkAuthorization('user123', 'doctor', registry).authorized).toBe(true);
      });

      it('should not allow admin-tier commands during bootstrap', () => {
        expect(registry.topicManagerAdmins).toEqual([]);

        const result = checkAuthorization('user123', 'list', registry);

        expect(result.authorized).toBe(false);
        expect(result.message).toContain('Not authorized');
      });
    });

    describe('admin authorization', () => {
      beforeEach(() => {
        registry.topicManagerAdmins = ['admin1', 'admin2'];
      });

      it('should allow admins to run admin commands', () => {
        const result = checkAuthorization('admin1', 'list', registry);

        expect(result.authorized).toBe(true);
      });

      it('should allow admins to run user commands', () => {
        const result = checkAuthorization('admin1', 'doctor', registry);

        expect(result.authorized).toBe(true);
      });

      it('should reject non-admins for admin commands', () => {
        const result = checkAuthorization('user123', 'list', registry);

        expect(result.authorized).toBe(false);
        expect(result.message).toContain('Not authorized');
      });
    });

    describe('user authorization', () => {
      beforeEach(() => {
        registry.topicManagerAdmins = ['admin1'];
      });

      it('should allow users in topicAllowFrom for user commands', () => {
        const topicAllowFrom = ['user123', 'user456'];

        const result = checkAuthorization('user123', 'doctor', registry, topicAllowFrom);

        expect(result.authorized).toBe(true);
      });

      it('should reject users not in topicAllowFrom for user commands', () => {
        const topicAllowFrom = ['user456'];

        const result = checkAuthorization('user123', 'doctor', registry, topicAllowFrom);

        expect(result.authorized).toBe(false);
        expect(result.message).toContain('Not authorized');
      });

      it('should reject users in topicAllowFrom for admin commands', () => {
        const topicAllowFrom = ['user123'];

        const result = checkAuthorization('user123', 'list', registry, topicAllowFrom);

        expect(result.authorized).toBe(false);
        expect(result.message).toContain('Not authorized');
      });

      it('should handle missing topicAllowFrom', () => {
        const result = checkAuthorization('user123', 'doctor', registry);

        expect(result.authorized).toBe(false);
      });

      it('should handle empty topicAllowFrom', () => {
        const result = checkAuthorization('user123', 'doctor', registry, []);

        expect(result.authorized).toBe(false);
      });
    });

    describe('init command special case', () => {
      beforeEach(() => {
        registry.topicManagerAdmins = ['admin1'];
      });

      it('should require authorization after first user', () => {
        const result = checkAuthorization('user123', 'init', registry);

        expect(result.authorized).toBe(false);
      });

      it('should allow admins to run init', () => {
        const result = checkAuthorization('admin1', 'init', registry);

        expect(result.authorized).toBe(true);
      });

      it('should allow users in topicAllowFrom to run init', () => {
        const topicAllowFrom = ['user123'];

        const result = checkAuthorization('user123', 'init', registry, topicAllowFrom);

        expect(result.authorized).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle multiple admins', () => {
        registry.topicManagerAdmins = ['admin1', 'admin2', 'admin3'];

        expect(checkAuthorization('admin2', 'list', registry).authorized).toBe(true);
        expect(checkAuthorization('admin3', 'sync', registry).authorized).toBe(true);
      });

      it('should handle userId matching in list', () => {
        registry.topicManagerAdmins = ['admin1'];
        const topicAllowFrom = ['user1'];

        expect(checkAuthorization('admin1', 'doctor', registry, topicAllowFrom).authorized).toBe(true);
        expect(checkAuthorization('user1', 'doctor', registry, topicAllowFrom).authorized).toBe(true);
        expect(checkAuthorization('user2', 'doctor', registry, topicAllowFrom).authorized).toBe(false);
      });

      it('should not allow partial userId matches', () => {
        registry.topicManagerAdmins = ['admin123'];

        expect(checkAuthorization('admin12', 'list', registry).authorized).toBe(false);
        expect(checkAuthorization('admin1234', 'list', registry).authorized).toBe(false);
      });
    });

    describe('principle of least privilege', () => {
      it('should default unknown commands to admin tier', () => {
        registry.topicManagerAdmins = ['admin1'];

        expect(checkAuthorization('user123', 'unknown-cmd', registry, ['user123']).authorized).toBe(false);
        expect(checkAuthorization('admin1', 'unknown-cmd', registry).authorized).toBe(true);
      });
    });
  });
});
