import { createHash } from 'crypto';

const RESOURCELESS_SENTINEL = '_none';

export interface CacheKeyInput {
  tenantId: string;
  tenantAuthzVersion: number;
  /** The caller's external user id — stable per tenant, matches what the request itself carries. */
  userId: string;
  userAuthzVersion: number;
  action: string;
  resourceType?: string;
  resourceId?: string;
  /** Whatever `resource`/`context` objects (if any) were supplied on the request. */
  resource?: unknown;
  context?: unknown;
}

/**
 * Cache key format (extends ADR-004, does not replace it):
 *
 *   authz:{tenantId}:{tenantAuthzVersion}:{userId}:{userAuthzVersion}:
 *         {action}:{resourceType}:{resourceId}:{attributesHash}
 *
 * Every dimension ADR-004 already required (tenant, tenantVersion, user,
 * userVersion, action, resourceType, resourceId) is present unchanged.
 * `attributesHash` is new in Phase 6 — see hashAttributes below for why
 * it's required: ADR-004 predates ABAC, where a decision can depend on
 * arbitrary caller-supplied resource/context attribute VALUES that
 * Ledger-Lock doesn't own, not just the resource's stable type/id.
 *
 * A resourceless check (no `resource` in the request at all) uses a
 * fixed sentinel for resourceType/resourceId rather than an empty
 * string, so "no resource" is never confusable with "a resource whose
 * type/id happens to be an empty string" in the unlikely event a caller
 * sent one.
 */
export function buildDecisionCacheKey(input: CacheKeyInput): string {
  return [
    'authz',
    input.tenantId,
    input.tenantAuthzVersion,
    input.userId,
    input.userAuthzVersion,
    input.action,
    input.resourceType ?? RESOURCELESS_SENTINEL,
    input.resourceId ?? RESOURCELESS_SENTINEL,
    hashAttributes(input.resource, input.context),
  ].join(':');
}

/**
 * Hashes the full resource/context payload as supplied on the request —
 * NOT just resourceId. Without this, two requests for the same
 * `resourceId` but different `resource` attribute values (e.g. an
 * invoice's `ownerId` changing hands, or simply two different callers
 * sending inconsistent attributes for what they claim is the same
 * resource) could incorrectly share a cache entry: Ledger-Lock doesn't
 * own resource data, so it has no way to know which attribute payload is
 * "correct" for a given resourceId — the only safe option is to key on
 * exactly what was evaluated.
 *
 * Object keys are sorted recursively before serializing so that
 * semantically identical payloads with differently-ordered keys hash
 * identically — JSON.stringify's key order otherwise follows insertion
 * order, which callers have no reason to keep consistent.
 *
 * Truncated to 16 hex chars (64 bits) — this is a cache-key
 * disambiguator, not a cryptographic authorization boundary — it
 * provides a strong probabilistic separation of distinct authorization
 * inputs, not an absolute guarantee, so full SHA-256 collision
 * resistance isn't required; 64 bits is already far beyond what a
 * realistic number of distinct attribute payloads per resource could
 * ever collide on by accident.
 */
export function hashAttributes(resource: unknown, context: unknown): string {
  const normalized = JSON.stringify(sortDeep({ resource: resource ?? null, context: context ?? null }));
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of entries) {
      result[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}
