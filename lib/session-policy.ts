export const SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_RENEWAL_THRESHOLD_SECONDS = 7 * 24 * 60 * 60;

export function sessionExpiresAt(now = Date.now()) {
  return new Date(now + SESSION_DURATION_SECONDS * 1000).toISOString();
}

export function shouldRenewSession(expiresAt: string, now = Date.now()) {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return true;
  return expiry <= now + SESSION_RENEWAL_THRESHOLD_SECONDS * 1000;
}
