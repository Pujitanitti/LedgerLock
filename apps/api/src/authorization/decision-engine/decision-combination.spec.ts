import { combineRbacAndAbac } from './decision-combination';
import type { AbacEvaluationResult } from '../policy-engine/policy-evaluation.service';

function abac(decision: AbacEvaluationResult['decision']): AbacEvaluationResult {
  return { decision, matchedPolicies: [] };
}

describe('combineRbacAndAbac — the complete combination matrix', () => {
  it('RBAC=false, ABAC=deny → DENY policy_deny', () => {
    expect(combineRbacAndAbac(false, abac('deny'))).toEqual({ allowed: false, reason: 'policy_deny' });
  });

  it('RBAC=true, ABAC=deny → DENY policy_deny (deny overrides an RBAC allow)', () => {
    expect(combineRbacAndAbac(true, abac('deny'))).toEqual({ allowed: false, reason: 'policy_deny' });
  });

  it('RBAC=true, ABAC=allow → ALLOW role_permission', () => {
    expect(combineRbacAndAbac(true, abac('allow'))).toEqual({ allowed: true, reason: 'role_permission' });
  });

  it('RBAC=true, ABAC=no_opinion → ALLOW role_permission', () => {
    expect(combineRbacAndAbac(true, abac('no_opinion'))).toEqual({ allowed: true, reason: 'role_permission' });
  });

  it('RBAC=false, ABAC=allow → ALLOW policy_allow (ABAC augments RBAC)', () => {
    expect(combineRbacAndAbac(false, abac('allow'))).toEqual({ allowed: true, reason: 'policy_allow' });
  });

  it('RBAC=false, ABAC=no_opinion → DENY no_matching_permission (default deny)', () => {
    expect(combineRbacAndAbac(false, abac('no_opinion'))).toEqual({
      allowed: false,
      reason: 'no_matching_permission',
    });
  });

  it('INVARIANT: DENY always wins regardless of RBAC state', () => {
    expect(combineRbacAndAbac(true, abac('deny')).allowed).toBe(false);
    expect(combineRbacAndAbac(false, abac('deny')).allowed).toBe(false);
  });

  it('INVARIANT: default deny holds when neither RBAC nor ABAC grants access', () => {
    expect(combineRbacAndAbac(false, abac('no_opinion')).allowed).toBe(false);
  });
});
