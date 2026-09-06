import { BadRequestException } from '@nestjs/common';
import { DecisionEngineService, MAX_BATCH_SIZE } from './decision-engine.service';
import { makeMockRbacRepository } from '../../rbac/test-utils/mock-rbac-repository';
import { PolicyEvaluationService } from '../policy-engine/policy-evaluation.service';
import {
  makeMockTenantRepo,
  makeMockDecisionCache,
  makeMockAuditService,
  makeMockConfigService,
} from './test-utils/mock-decision-engine-deps';
import type { UserRepositoryPort } from '../../users/repositories/user-repository.port';
import type { UserRecord } from '../../users/types/user-record';
import type { Decision } from './types';

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user_1',
    tenantId: 'tenant_a',
    externalId: 'ext_alice',
    authzVersion: 1,
    attributes: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeUserRepo(overrides: Partial<jest.Mocked<UserRepositoryPort>> = {}): jest.Mocked<UserRepositoryPort> {
  return {
    create: jest.fn(),
    findByExternalId: jest.fn(),
    findById: jest.fn(),
    findManyByExternalIds: jest.fn(),
    list: jest.fn(),
    ...overrides,
  } as jest.Mocked<UserRepositoryPort>;
}

/**
 * A PolicyEvaluationService double that always reports "no_opinion" -
 * i.e. no ABAC policies exist/apply. Used across all of these Phase 4
 * regression tests so RBAC-only behavior can be verified in isolation,
 * exactly as it was before Phase 5 introduced ABAC. See
 * decision-combination.spec.ts for the exhaustive RBAC x ABAC matrix.
 */
function makeNoOpinionPolicyEvaluation(): jest.Mocked<
  Pick<PolicyEvaluationService, 'evaluate' | 'evaluateAgainstCandidates' | 'fetchCandidates'>
> {
  return {
    evaluate: jest.fn().mockResolvedValue({ decision: 'no_opinion', matchedPolicies: [] }),
    evaluateAgainstCandidates: jest.fn().mockReturnValue({ decision: 'no_opinion', matchedPolicies: [] }),
    fetchCandidates: jest.fn().mockResolvedValue([]),
  };
}

function core(decision: Decision): { allowed: boolean; reason: string } {
  return { allowed: decision.allowed, reason: decision.reason };
}

describe('DecisionEngineService.evaluate - deny-by-default (RBAC-only, ABAC=no_opinion)', () => {
  it('DENIES with unknown_user when the user does not exist for this tenant', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(null) });
    const rbacRepo = makeMockRbacRepository();
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', { userId: 'ext_ghost', action: 'projects:read' }, 'req_test');

    expect(core(decision)).toEqual({ allowed: false, reason: 'unknown_user' });
    expect(rbacRepo.listRoleIdsForUser).not.toHaveBeenCalled();
  });

  it('DENIES with no_matching_permission when the user has no roles at all', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({ listRoleIdsForUser: jest.fn().mockResolvedValue([]) });
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'projects:read' }, 'req_test');

    expect(core(decision)).toEqual({ allowed: false, reason: 'no_matching_permission' });
    expect(rbacRepo.getEffectivePermissionActions).not.toHaveBeenCalled();
  });

  it('DENIES with no_matching_permission when roles exist but none grant the requested action', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_member']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['projects:read']),
    });
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'projects:delete' }, 'req_test');

    expect(core(decision)).toEqual({ allowed: false, reason: 'no_matching_permission' });
  });

  it('ALLOWS via role_permission when an effective permission matches the requested action', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_admin']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['projects:read', 'projects:delete']),
    });
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'projects:delete' }, 'req_test');

    expect(core(decision)).toEqual({ allowed: true, reason: 'role_permission' });
  });

  it('ALLOWS via an inherited permission - trusts whatever the RBAC repository reports as effective', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_owner']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['member:read', 'admin:manage', 'owner:billing']),
    });
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'member:read' }, 'req_test');

    expect(core(decision)).toEqual({ allowed: true, reason: 'role_permission' });
    expect(rbacRepo.getEffectivePermissionActions).toHaveBeenCalledWith('tenant_a', ['role_owner']);
  });

  it('DENIES with resource_tenant_mismatch when the resource claims a different tenant', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_admin']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['invoices:delete']),
    });
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', {
      userId: 'ext_alice',
      action: 'invoices:delete',
      resource: { type: 'invoice', id: 'inv_1', tenantId: 'tenant_b' },
    }, 'req_test');

    expect(core(decision)).toEqual({ allowed: false, reason: 'resource_tenant_mismatch' });
    expect(rbacRepo.listRoleIdsForUser).not.toHaveBeenCalled();
  });

  it('does not deny for a resource with no tenantId asserted at all', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_admin']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['invoices:delete']),
    });
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', {
      userId: 'ext_alice',
      action: 'invoices:delete',
      resource: { type: 'invoice', id: 'inv_1' },
    }, 'req_test');

    expect(core(decision)).toEqual({ allowed: true, reason: 'role_permission' });
  });

  it('allows a resource whose tenantId matches the authenticated tenant', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_admin']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['invoices:delete']),
    });
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', {
      userId: 'ext_alice',
      action: 'invoices:delete',
      resource: { type: 'invoice', id: 'inv_1', tenantId: 'tenant_a' },
    }, 'req_test');

    expect(core(decision)).toEqual({ allowed: true, reason: 'role_permission' });
  });

  it('SECURITY: looks up the user scoped to the authenticated tenant, never a global lookup', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(null) });
    const rbacRepo = makeMockRbacRepository();
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'projects:read' }, 'req_test');

    expect(userRepo.findByExternalId).toHaveBeenCalledWith('tenant_a', 'ext_alice');
  });

  it('includes provenance detail on every decision', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_admin']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['projects:read']),
    });
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'projects:read' }, 'req_test');

    expect(decision.provenance).toEqual({
      rbacAllowed: true,
      directRoleIds: ['role_admin'],
      matchedPolicies: [],
      decidingPolicyId: undefined,
      decidingPolicyVersion: undefined,
    });
  });
});

describe('DecisionEngineService.evaluateBatch (RBAC-only, ABAC=no_opinion)', () => {
  it('returns decisions in the same order the requests were submitted', async () => {
    const userA = makeUser({ id: 'u_a', externalId: 'ext_a' });
    const userB = makeUser({ id: 'u_b', externalId: 'ext_b' });
    const userRepo = makeUserRepo({ findManyByExternalIds: jest.fn().mockResolvedValue([userA, userB]) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockImplementation((_t, userId) => {
        return Promise.resolve(userId === 'u_a' ? ['role_a'] : ['role_b']);
      }),
      getEffectivePermissionActions: jest.fn().mockImplementation((_t, roleIds: string[]) => {
        return Promise.resolve(roleIds.includes('role_a') ? ['x:read'] : ['y:read']);
      }),
    });
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decisions = await engine.evaluateBatch('tenant_a', [
      { userId: 'ext_b', action: 'y:read' },
      { userId: 'ext_a', action: 'x:read' },
      { userId: 'ext_a', action: 'z:read' },
    ], 'req_test');

    expect(decisions.map(core)).toEqual([
      { allowed: true, reason: 'role_permission' },
      { allowed: true, reason: 'role_permission' },
      { allowed: false, reason: 'no_matching_permission' },
    ]);
  });

  it('resolves each distinct user only once, even when referenced by multiple items (no N+1)', async () => {
    const user = makeUser();
    const userRepo = makeUserRepo({ findManyByExternalIds: jest.fn().mockResolvedValue([user]) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_1']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['x:read', 'x:write']),
    });
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    await engine.evaluateBatch('tenant_a', [
      { userId: 'ext_alice', action: 'x:read' },
      { userId: 'ext_alice', action: 'x:write' },
      { userId: 'ext_alice', action: 'x:delete' },
    ], 'req_test');

    expect(userRepo.findManyByExternalIds).toHaveBeenCalledTimes(1);
    expect(rbacRepo.listRoleIdsForUser).toHaveBeenCalledTimes(1);
    expect(rbacRepo.getEffectivePermissionActions).toHaveBeenCalledTimes(1);
  });

  it('fetches the tenant policy candidate list exactly once for the whole batch (no N+1 on ABAC either)', async () => {
    const userRepo = makeUserRepo({ findManyByExternalIds: jest.fn().mockResolvedValue([makeUser()]) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_1']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['x:read']),
    });
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    await engine.evaluateBatch('tenant_a', [
      { userId: 'ext_alice', action: 'x:read' },
      { userId: 'ext_alice', action: 'x:write' },
      { userId: 'ext_alice', action: 'x:delete' },
    ], 'req_test');

    expect(policyEval.fetchCandidates).toHaveBeenCalledTimes(1);
    expect(policyEval.evaluateAgainstCandidates).toHaveBeenCalledTimes(3);
  });

  it('fetches all distinct users in a single query', async () => {
    const userRepo = makeUserRepo({ findManyByExternalIds: jest.fn().mockResolvedValue([]) });
    const rbacRepo = makeMockRbacRepository();
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    await engine.evaluateBatch('tenant_a', [
      { userId: 'ext_a', action: 'x:read' },
      { userId: 'ext_b', action: 'x:read' },
      { userId: 'ext_a', action: 'x:write' },
    ], 'req_test');

    expect(userRepo.findManyByExternalIds).toHaveBeenCalledWith('tenant_a', ['ext_a', 'ext_b']);
  });

  it('DENIES individual items independently for unknown users mixed with known ones', async () => {
    const user = makeUser({ externalId: 'ext_known' });
    const userRepo = makeUserRepo({ findManyByExternalIds: jest.fn().mockResolvedValue([user]) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_1']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['x:read']),
    });
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decisions = await engine.evaluateBatch('tenant_a', [
      { userId: 'ext_known', action: 'x:read' },
      { userId: 'ext_ghost', action: 'x:read' },
    ], 'req_test');

    expect(decisions.map(core)).toEqual([
      { allowed: true, reason: 'role_permission' },
      { allowed: false, reason: 'unknown_user' },
    ]);
  });

  it('applies the resource-tenant check independently per item in a batch', async () => {
    const user = makeUser();
    const userRepo = makeUserRepo({ findManyByExternalIds: jest.fn().mockResolvedValue([user]) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_1']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['invoices:delete']),
    });
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decisions = await engine.evaluateBatch('tenant_a', [
      { userId: 'ext_alice', action: 'invoices:delete', resource: { type: 'invoice', id: '1', tenantId: 'tenant_b' } },
      { userId: 'ext_alice', action: 'invoices:delete', resource: { type: 'invoice', id: '2', tenantId: 'tenant_a' } },
    ], 'req_test');

    expect(decisions.map(core)).toEqual([
      { allowed: false, reason: 'resource_tenant_mismatch' },
      { allowed: true, reason: 'role_permission' },
    ]);
  });

  it('rejects a batch larger than MAX_BATCH_SIZE with BadRequestException, and never begins evaluating it', async () => {
    const userRepo = makeUserRepo();
    const rbacRepo = makeMockRbacRepository();
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const oversized = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => ({
      userId: `ext_${i}`,
      action: 'x:read',
    }));

    await expect(engine.evaluateBatch('tenant_a', oversized, 'req_test')).rejects.toBeInstanceOf(BadRequestException);
    expect(userRepo.findManyByExternalIds).not.toHaveBeenCalled();
  });

  it('accepts a batch exactly at MAX_BATCH_SIZE', async () => {
    const userRepo = makeUserRepo({ findManyByExternalIds: jest.fn().mockResolvedValue([]) });
    const rbacRepo = makeMockRbacRepository();
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const exact = Array.from({ length: MAX_BATCH_SIZE }, (_, i) => ({ userId: `ext_${i}`, action: 'x:read' }));

    const decisions = await engine.evaluateBatch('tenant_a', exact, 'req_test');
    expect(decisions).toHaveLength(MAX_BATCH_SIZE);
  });

  it('returns an empty array for an empty batch without touching the database', async () => {
    const userRepo = makeUserRepo();
    const rbacRepo = makeMockRbacRepository();
    const policyEval = makeNoOpinionPolicyEvaluation();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEval as unknown as PolicyEvaluationService,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decisions = await engine.evaluateBatch('tenant_a', [], 'req_test');

    expect(decisions).toEqual([]);
    expect(userRepo.findManyByExternalIds).not.toHaveBeenCalled();
  });
});
