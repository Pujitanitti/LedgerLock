import type { AbacEvaluationResult } from '../policy-engine/policy-evaluation.service';
import type { DecisionReason } from './types';

export interface CombinedDecision {
  allowed: boolean;
  reason: DecisionReason;
}

/**
 * THE authoritative combination table for RBAC and ABAC results - see
 * docs/decisions/ADR-010-rbac-abac-interaction.md for the full write-up.
 * Every branch here is deliberate; there are exactly four possible
 * outcomes for the six (rbacAllowed x abac.decision) input combinations:
 *
 * | RBAC allowed | ABAC decision | Result | Reason                 |
 * |--------------|----------------|--------|------------------------|
 * | false        | deny           | DENY   | policy_deny            |
 * | true         | deny           | DENY   | policy_deny            |
 * | true         | allow          | ALLOW  | role_permission        |
 * | true         | no_opinion     | ALLOW  | role_permission        |
 * | false        | allow          | ALLOW  | policy_allow           |
 * | false        | no_opinion     | DENY   | no_matching_permission |
 *
 * DENY > ALLOW is unconditional: an ABAC deny wins regardless of RBAC -
 * checked first, before anything else. ABAC AUGMENTS RBAC rather than
 * only restricting it: an ABAC allow can grant access even when RBAC
 * alone would deny (row 5) - this is deliberate ("resource ownership"
 * conditions are exactly this case: a user might have no role granting
 * `invoices:update` at all, yet a policy says "the owner of an invoice
 * may update it"). When RBAC already allows, its reason is reported even
 * if ABAC also happened to match an allow policy - RBAC is treated as
 * the more foundational grant for reporting purposes, though a caller
 * wanting full detail can inspect DecisionProvenance.matchedPolicies.
 */
export function combineRbacAndAbac(rbacAllowed: boolean, abac: AbacEvaluationResult): CombinedDecision {
  if (abac.decision === 'deny') {
    return { allowed: false, reason: 'policy_deny' };
  }
  if (rbacAllowed) {
    return { allowed: true, reason: 'role_permission' };
  }
  if (abac.decision === 'allow') {
    return { allowed: true, reason: 'policy_allow' };
  }
  return { allowed: false, reason: 'no_matching_permission' };
}
