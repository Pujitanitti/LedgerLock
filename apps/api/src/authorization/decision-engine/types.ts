import type { MatchedPolicy } from '../policy-engine/policy-evaluation.service';

export interface ResourceContext {
  type: string;
  id: string;
  /**
   * If the caller includes this, it is checked against the authenticated
   * tenant — a mismatch is an immediate deny. This is a structural
   * consistency check ("is this resource even claimed to belong to my
   * tenant"), not full resource-ownership authorization — that's now
   * handled by ABAC conditions (e.g. "resource.ownerId equals
   * subject.id"), added in Phase 5.
   */
  tenantId?: string;
  [key: string]: unknown;
}

export interface CheckRequestInput {
  /** The CALLER's own external user identifier — resolved against User.externalId. */
  userId: string;
  action: string;
  resource?: ResourceContext;
  /** Caller-supplied request context (IP, etc.) — available to ABAC conditions as "context.*". */
  context?: Record<string, unknown>;
}

export type DecisionReason =
  | 'unknown_user'
  | 'resource_tenant_mismatch'
  | 'policy_deny'
  | 'role_permission'
  | 'policy_allow'
  | 'no_matching_permission';

/**
 * Internal-only decision detail — never serialized to the public
 * /v1/check response (see CheckResponseDto, which carries only
 * `allowed`/`reason`). Kept here so the decision is fully explainable for
 * debugging/future audit logging (Phase 6) without exposing policy IDs,
 * role IDs, or version numbers through the public API surface.
 */
export interface DecisionProvenance {
  rbacAllowed: boolean;
  directRoleIds: string[];
  matchedPolicies: MatchedPolicy[];
  decidingPolicyId?: string;
  decidingPolicyVersion?: number;
}

export interface Decision {
  allowed: boolean;
  reason: DecisionReason;
  provenance?: DecisionProvenance;
}
