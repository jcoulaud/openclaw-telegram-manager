import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeActivityTier } from '../src/lib/activity.js';

describe('computeActivityTier', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return "cold" for null lastMessageAt', () => {
    expect(computeActivityTier(null)).toBe('cold');
  });

  it('should return "hot" for recent activity (<4 hours)', () => {
    const oneHourAgo = new Date(Date.now() - 1 * 3_600_000).toISOString();
    expect(computeActivityTier(oneHourAgo)).toBe('hot');
  });

  it('should return "hot" for activity 3 hours ago', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(computeActivityTier(threeHoursAgo)).toBe('hot');
  });

  it('should return "warm" for activity 5 hours ago', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3_600_000).toISOString();
    expect(computeActivityTier(fiveHoursAgo)).toBe('warm');
  });

  it('should return "warm" for activity <24 hours ago', () => {
    const twentyHoursAgo = new Date(Date.now() - 20 * 3_600_000).toISOString();
    expect(computeActivityTier(twentyHoursAgo)).toBe('warm');
  });

  it('should return "cold" for activity >24 hours ago', () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 3_600_000).toISOString();
    expect(computeActivityTier(twoDaysAgo)).toBe('cold');
  });

  it('should return "cold" for activity exactly 24 hours ago', () => {
    const exactlyOneDayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
    expect(computeActivityTier(exactlyOneDayAgo)).toBe('cold');
  });
});
