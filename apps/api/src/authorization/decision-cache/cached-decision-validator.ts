import type { CachedDecision } from './decision-cache.port';

/**
 * Mirrors DecisionReason (authorization/decision-engine/types.ts) as a
 * runtime set — TypeScript types don't exist at runtime, so a value read
 * back from Redis (which could be anything: truncated JSON, a value
 * written by an old app version, or genuinely corrupted data) needs an
 * explicit runtime check before it's ever trusted as a real decision.
 */
const VALID_REASONS = new Set([
  'unknown_user',
  'resource_tenant_mismatch',
  'policy_deny',
  'role_permission',
  'policy_allow',
  'no_matching_permission',
]);

/**
 * Returns false for ANYTHING that isn't exactly the expected shape —
 * extra fields, wrong types, an unrecognized reason string, or not an
 * object at all. A false result means "treat as a cache miss," never
 * "attempt to coerce/repair it." See ADR-012 / DecisionCachePort's own
 * doc comment: malformed cache data must never become an authorization
 * bypass.
 */
export function isCachedDecision(value: unknown): value is CachedDecision {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.allowed === 'boolean' &&
    typeof candidate.reason === 'string' &&
    VALID_REASONS.has(candidate.reason)
  );
}
