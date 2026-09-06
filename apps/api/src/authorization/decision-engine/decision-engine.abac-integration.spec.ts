import { DecisionEngineService } from './decision-engine.service';
import { PolicyEvaluationService } from '../policy-engine/policy-evaluation.service';
import {
  makeMockTenantRepo,
  makeMockDecisionCache,
  makeMockAuditService,
  makeMockConfigService,
} from './test-utils/mock-decision-engine-deps';
import { makeMockRbacRepository } from '../../rbac/test-utils/mock-rbac-repository';
import type { UserRepositoryPort } from '../../users/repositories/user-repository.port';
import type { UserRecord } from '../../users/types/user-record';
import type { PolicyRepositoryPort } from '../../policies/repositories/policy-repository.port';
import type { PolicyVersionRecord } from '../../policies/types/policy-record';

/**
 * These tests use a REAL PolicyEvaluationService (only the persistence
 * port underneath it is mocked) wired into a REAL DecisionEngineService —
 * unlike decision-engine.service.spec.ts, which mocks PolicyEvaluationService
 * entirely to isolate RBAC behavior. This proves the actual integration:
 * that an ABAC decision computed from real condition evaluation flows
 * through combineRbacAndAbac and comes out the other end of
 * DecisionEngineService.evaluate correctly.
 */
function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user_1',
    tenantId: 'tenant_a',
    externalId: 'ext_alice',
    authzVersion: 1,
    attributes: { department: 'finance' },
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

function makeVersion(overrides: Partial<PolicyVersionRecord> = {}): PolicyVersionRecord {
  return {
    id: 'pv_1',
    policyId: 'policy_1',
    tenantId: 'tenant_a',
    version: 1,
    effect: 'allow',
    actions: ['invoices:update'],
    resourceTypes: ['invoice'],
    conditions: [],
    priority: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

function makePolicyRepo(candidates: PolicyVersionRecord[]): jest.Mocked<PolicyRepositoryPort> {
  return {
    createPolicy: jest.fn(),
    findPolicyById: jest.fn(),
    findPolicyByName: jest.fn(),
    listPolicies: jest.fn(),
    setEnabled: jest.fn(),
    deletePolicy: jest.fn(),
    getCurrentVersion: jest.fn(),
    listVersionHistory: jest.fn(),
    createNewVersion: jest.fn(),
    listCandidateVersionsForCheck: jest.fn().mockResolvedValue(candidates),
  } as jest.Mocked<PolicyRepositoryPort>;
}

describe('DecisionEngineService + real PolicyEvaluationService — end-to-end ABAC integration', () => {
  it('ALLOWS via policy_allow when RBAC has no permission but an ownership condition matches', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({ listRoleIdsForUser: jest.fn().mockResolvedValue([]) }); // no RBAC roles at all
    const ownershipPolicy = makeVersion({
      effect: 'allow',
      conditions: [{ field: 'resource.ownerId', operator: 'equals', value: { ref: 'subject.id' } }],
    });
    const policyEvaluation = new PolicyEvaluationService(makePolicyRepo([ownershipPolicy]));
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEvaluation,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', {
      userId: 'ext_alice',
      action: 'invoices:update',
      resource: { type: 'invoice', id: 'inv_1', ownerId: 'ext_alice' },
    }, 'req_test');

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('policy_allow');
  });

  it('DENIES via policy_deny even when RBAC alone would allow', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_admin']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['invoices:delete']),
    });
    const denyPolicy = makeVersion({
      effect: 'deny',
      actions: ['invoices:delete'],
      conditions: [{ field: 'subject.department', operator: 'not_equals', value: 'billing' }],
    });
    const policyEvaluation = new PolicyEvaluationService(makePolicyRepo([denyPolicy]));
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEvaluation,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', {
      userId: 'ext_alice',
      action: 'invoices:delete',
      resource: { type: 'invoice', id: 'inv_1' },
    }, 'req_test');

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('policy_deny');
  });

  it('subject attributes from User.attributes reach condition evaluation correctly', async () => {
    const userRepo = makeUserRepo({
      findByExternalId: jest.fn().mockResolvedValue(makeUser({ attributes: { department: 'finance' } })),
    });
    const rbacRepo = makeMockRbacRepository({ listRoleIdsForUser: jest.fn().mockResolvedValue([]) });
    const departmentPolicy = makeVersion({
      effect: 'allow',
      conditions: [{ field: 'subject.department', operator: 'equals', value: 'finance' }],
    });
    const policyEvaluation = new PolicyEvaluationService(makePolicyRepo([departmentPolicy]));
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEvaluation,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', {
      userId: 'ext_alice',
      action: 'invoices:update',
      resource: { type: 'invoice', id: 'inv_1' },
    }, 'req_test');

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('policy_allow');
  });

  it('context attributes from the request reach condition evaluation correctly', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({ listRoleIdsForUser: jest.fn().mockResolvedValue([]) });
    const ipPolicy = makeVersion({
      effect: 'deny',
      resourceTypes: ['*'],
      conditions: [{ field: 'context.ip', operator: 'starts_with', value: '10.' }],
    });
    const policyEvaluation = new PolicyEvaluationService(makePolicyRepo([ipPolicy]));
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEvaluation,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', {
      userId: 'ext_alice',
      action: 'invoices:update',
      context: { ip: '10.0.0.5' },
    }, 'req_test');

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('policy_deny');
  });

  it('still denies by default when neither RBAC nor any policy applies', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({ listRoleIdsForUser: jest.fn().mockResolvedValue([]) });
    const policyEvaluation = new PolicyEvaluationService(makePolicyRepo([]));
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEvaluation,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'invoices:update' }, 'req_test');

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('no_matching_permission');
  });

  it('provenance identifies the deciding policy through the full stack', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({ listRoleIdsForUser: jest.fn().mockResolvedValue([]) });
    const allowPolicy = makeVersion({ policyId: 'policy_xyz', version: 3, effect: 'allow' });
    const policyEvaluation = new PolicyEvaluationService(makePolicyRepo([allowPolicy]));
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      policyEvaluation,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', {
      userId: 'ext_alice',
      action: 'invoices:update',
      resource: { type: 'invoice', id: 'inv_1' },
    }, 'req_test');

    expect(decision.provenance?.decidingPolicyId).toBe('policy_xyz');
    expect(decision.provenance?.decidingPolicyVersion).toBe(3);
  });
});
