import { Inject, Injectable } from '@nestjs/common';
import { POLICY_REPOSITORY, type PolicyRepositoryPort } from '../../policies/repositories/policy-repository.port';
import { evaluateAllConditions } from '../conditions/condition-evaluator';
import type { EvaluationAttributes } from '../conditions/condition-types';
import { actionsMatchAny, resourceTypesMatchAny } from './policy-matching';
import type { PolicyVersionRecord } from '../../policies/types/policy-record';

export type AbacDecision = 'allow' | 'deny' | 'no_opinion';

export interface MatchedPolicy {
  policyId: string;
  version: number;
  effect: 'allow' | 'deny';
  priority: number;
}

export interface AbacEvaluationResult {
  decision: AbacDecision;
  /** Every policy version that matched — for decision provenance (see #11). */
  matchedPolicies: MatchedPolicy[];
  /** The single policy "cited" as responsible for the decision, chosen deterministically. */
  decidingPolicy?: MatchedPolicy;
}

/**
 * The ABAC half of the authorization pipeline. Deliberately does NOT
 * know about RBAC at all — DecisionEngineService combines this result
 * with the RBAC result. See docs/decisions/ADR-010-rbac-abac-interaction.md
 * for the full combination algorithm and why DENY always wins here
 * regardless of what RBAC says.
 */
@Injectable()
export class PolicyEvaluationService {
  constructor(@Inject(POLICY_REPOSITORY) private readonly repository: PolicyRepositoryPort) {}

  /** Fetches a tenant's enabled-policy candidates once — reusable across many evaluate() calls in a batch. */
  async fetchCandidates(tenantId: string): Promise<PolicyVersionRecord[]> {
    return this.repository.listCandidateVersionsForCheck(tenantId);
  }

  async evaluate(tenantId: string, action: string, attributes: EvaluationAttributes): Promise<AbacEvaluationResult> {
    const candidates = await this.fetchCandidates(tenantId);
    return this.evaluateAgainstCandidates(candidates, action, attributes);
  }

  /**
   * Pure evaluation against an already-fetched candidate list — the
   * batch check path (DecisionEngineService.evaluateBatch) fetches a
   * tenant's candidates exactly once and calls this directly for every
   * item, rather than re-querying the database per item.
   */
  evaluateAgainstCandidates(
    candidates: readonly PolicyVersionRecord[],
    action: string,
    attributes: EvaluationAttributes,
  ): AbacEvaluationResult {
    const requestedResourceType = attributes.resource?.type;

    const matched: MatchedPolicy[] = [];
    for (const version of candidates) {
      if (!actionsMatchAny(version.actions, action)) continue;
      if (!resourceTypesMatchAny(version.resourceTypes, requestedResourceType)) continue;
      if (!evaluateAllConditions(version.conditions, attributes)) continue;

      matched.push({
        policyId: version.policyId,
        version: version.version,
        effect: version.effect,
        priority: version.priority,
      });
    }

    if (matched.length === 0) {
      return { decision: 'no_opinion', matchedPolicies: [] };
    }

    // DENY > ALLOW: the presence of even one matched deny policy makes
    // the overall ABAC decision "deny", regardless of how many allow
    // policies also matched. This check is order-independent (.filter
    // over the whole matched set) — it never depends on which policy the
    // database happened to return first.
    const denyMatches = matched.filter((m) => m.effect === 'deny');
    if (denyMatches.length > 0) {
      return { decision: 'deny', matchedPolicies: matched, decidingPolicy: pickDeterministic(denyMatches) };
    }

    return { decision: 'allow', matchedPolicies: matched, decidingPolicy: pickDeterministic(matched) };
  }
}

/**
 * Chooses which single policy is reported as "the" deciding one when
 * multiple matched with the same effect — highest `priority` first, then
 * lexicographically smallest `policyId` as a final tiebreaker. This is
 * for explainability/provenance ONLY; it never changes the allow/deny
 * outcome itself (that's determined purely by "did any deny match"), and
 * it never depends on array/database iteration order — the same input
 * set produces the same `decidingPolicy` no matter what order it arrives
 * in, which is what "deterministic" requires.
 */
function pickDeterministic(policies: readonly MatchedPolicy[]): MatchedPolicy {
  return [...policies].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.policyId.localeCompare(b.policyId);
  })[0];
}
