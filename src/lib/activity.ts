export type ActivityTier = 'hot' | 'warm' | 'cold';

export function computeActivityTier(lastMessageAt: string | null): ActivityTier {
  if (!lastMessageAt) return 'cold';
  const hours = (Date.now() - new Date(lastMessageAt).getTime()) / 3_600_000;
  if (hours < 4) return 'hot';
  if (hours < 24) return 'warm';
  return 'cold';
}
