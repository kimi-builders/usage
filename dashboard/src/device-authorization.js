export function resolveCommunityStatus(community, now = Date.now()) {
  const status = community?.status
    || (community?.connected ? 'connected' : 'disconnected');
  if (status !== 'pending') return status;

  const expiresAt = Date.parse(community?.authorization?.expiresAt || '');
  if (!Number.isFinite(expiresAt)) return status;
  return expiresAt <= now ? 'expired' : status;
}
