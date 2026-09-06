export type ApiKeyStatus = 'revoked' | 'expired' | 'active';

/**
 * Determines an API key's status from its revocation/expiry timestamps.
 * A pure function (no I/O, no clock access beyond the injected `now`) so
 * every branch — including the exact-boundary expiry case — is directly
 * unit-testable without a database.
 *
 * Revocation is checked before expiry: a key that is both revoked AND
 * past its expiry is reported as "revoked" (the more specific/intentional
 * state), which also determines which error the caller ultimately sees.
 */
export function evaluateApiKeyStatus(
  record: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date = new Date(),
): ApiKeyStatus {
  if (record.revokedAt !== null) return 'revoked';
  if (record.expiresAt !== null && record.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}
