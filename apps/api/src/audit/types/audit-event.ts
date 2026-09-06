import type { MatchedPolicy } from '../../authorization/policy-engine/policy-evaluation.service';

/**
 * The full record of one authorization decision, as it flows into the
 * outbox. Field selection follows the existing AuditLog schema
 * (extended in Phase 6 — see prisma/schema.prisma comments) rather than
 * the Phase 6 teaser's suggested shape verbatim: no separate
 * `correlationId` (the project already has `requestId` for this via
 * RequestIdMiddleware — adding a second correlation field would just be
 * two names for the same concept), and no raw `authorizationContext`
 * blob (the caller-supplied `context`/`resource` objects could contain
 * values a tenant doesn't want duplicated indefinitely into an audit
 * table with no redaction — logging matched policy IDs/versions and the
 * decision itself is enough for "explainable," without also persisting
 * arbitrary attribute payloads that were never validated for what's
 * safe to retain long-term).
 */
export interface AuditDecisionEvent {
  tenantId: string;
  /** The caller's external user id, matching what they'd search their own audit trail by. */
  userId: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  decision: 'allow' | 'deny';
  reason: string;
  policyId: string | null;
  policyVersionNumber: number | null;
  matchedPolicies: MatchedPolicy[] | null;
  /**
   * Honesty flag, not a detail to hide: when true, `matchedPolicies`
   * above is null/empty because the decision was served from cache and
   * provenance was never recomputed — NOT because no policy actually
   * applied. See ADR-012 on why provenance isn't cached.
   */
  servedFromCache: boolean;
  latencyMs: number;
  requestId: string;
}
