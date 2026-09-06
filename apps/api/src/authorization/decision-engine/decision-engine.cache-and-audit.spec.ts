import { DecisionEngineService } from './decision-engine.service';
import { PolicyEvaluationService } from '../policy-engine/policy-evaluation.service';
import { makeMockRbacRepository } from '../../rbac/test-utils/mock-rbac-repository';
import {
  makeMockTenantRepo,
  makeMockDecisionCache,
  makeMockAuditService,
  makeMockConfigService,
} from './test-utils/mock-decision-engine-deps';
import type { UserRepositoryPort } from '../../users/repositories/user-repository.port';
import type { UserRecord } from '../../users/types/user-record';
import type { PolicyRepositoryPort } from '../../policies/repositories/policy-repository.port';
import type { CachedDecision, DecisionCachePort } from '../decision-cache/decision-cache.port';

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
    incrementAuthzVersion: jest.fn(),
    ...overrides,
  } as jest.Mocked<UserRepositoryPort>;
}

function makeEmptyPolicyRepo(): jest.Mocked<PolicyRepositoryPort> {
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
    listCandidateVersionsForCheck: jest.fn().mockResolvedValue([]),
  } as jest.Mocked<PolicyRepositoryPort>;
}

/**
 * A real, in-memory implementation of DecisionCachePort, used for the
 * end-to-end version-invalidation tests below — mocking `.get`/`.set`
 * blindly would not actually prove the cache KEY itself changes when the
 * tenant/user version changes; a real store does.
 */
class FakeInMemoryDecisionCache implements DecisionCachePort {
  private readonly store = new Map<string, CachedDecision>();
  async get(key: string): Promise<CachedDecision | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, decision: CachedDecision): Promise<void> {
    this.store.set(key, decision);
  }
  size(): number {
    return this.store.size;
  }
}

describe('DecisionEngineService.evaluate - cache hit short-circuits authoritative evaluation', () => {
  it('does not touch RBAC or ABAC at all on a cache hit', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository();
    const tenantRepo = makeMockTenantRepo();
    const decisionCache = makeMockDecisionCache({
      get: jest.fn().mockResolvedValue({ allowed: true, reason: 'role_permission' }),
    });
    const policyEval = new PolicyEvaluationService(makeEmptyPolicyRepo());
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      tenantRepo,
      decisionCache,
      policyEval,
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'projects:read' }, 'req_1');

    expect(decision).toEqual({ allowed: true, reason: 'role_permission' });
    expect(rbacRepo.listRoleIdsForUser).not.toHaveBeenCalled();
    expect(rbacRepo.getEffectivePermissionActions).not.toHaveBeenCalled();
  });

  it('a cache hit carries no provenance (never recomputed)', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const decisionCache = makeMockDecisionCache({
      get: jest.fn().mockResolvedValue({ allowed: false, reason: 'no_matching_permission' }),
    });
    const engine = new DecisionEngineService(
      userRepo,
      makeMockRbacRepository(),
      makeMockTenantRepo(),
      decisionCache,
      new PolicyEvaluationService(makeEmptyPolicyRepo()),
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'projects:read' }, 'req_1');

    expect(decision.provenance).toBeUndefined();
  });
});

describe('DecisionEngineService.evaluate - cache miss writes the decision back', () => {
  it('writes {allowed, reason} to the cache (not the full Decision with provenance)', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_admin']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['projects:read']),
    });
    const decisionCache = makeMockDecisionCache();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      decisionCache,
      new PolicyEvaluationService(makeEmptyPolicyRepo()),
      makeMockAuditService() as never,
      makeMockConfigService(120) as never,
    );

    await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'projects:read' }, 'req_1');

    expect(decisionCache.set).toHaveBeenCalledWith(
      expect.any(String),
      { allowed: true, reason: 'role_permission' },
      120,
    );
  });

  it('does not write to the cache when the tenant authz version is unavailable', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const tenantRepo = makeMockTenantRepo({ getAuthzVersion: jest.fn().mockResolvedValue(null) });
    const rbacRepo = makeMockRbacRepository({ listRoleIdsForUser: jest.fn().mockResolvedValue([]) });
    const decisionCache = makeMockDecisionCache();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      tenantRepo,
      decisionCache,
      new PolicyEvaluationService(makeEmptyPolicyRepo()),
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'projects:read' }, 'req_1');

    expect(decisionCache.get).not.toHaveBeenCalled();
    expect(decisionCache.set).not.toHaveBeenCalled();
  });
});

describe('DecisionEngineService.evaluate - audit is recorded on both hit and miss', () => {
  it('records an audit event on a cache HIT with servedFromCache=true and no matchedPolicies', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const decisionCache = makeMockDecisionCache({
      get: jest.fn().mockResolvedValue({ allowed: true, reason: 'role_permission' }),
    });
    const auditService = makeMockAuditService();
    const engine = new DecisionEngineService(
      userRepo,
      makeMockRbacRepository(),
      makeMockTenantRepo(),
      decisionCache,
      new PolicyEvaluationService(makeEmptyPolicyRepo()),
      auditService as never,
      makeMockConfigService() as never,
    );

    await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'projects:read' }, 'req_1');

    expect(auditService.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ servedFromCache: true, matchedPolicies: null, decision: 'allow' }),
    );
  });

  it('records an audit event on a cache MISS with servedFromCache=false and real matchedPolicies', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_admin']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['projects:read']),
    });
    const auditService = makeMockAuditService();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      new PolicyEvaluationService(makeEmptyPolicyRepo()),
      auditService as never,
      makeMockConfigService() as never,
    );

    await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'projects:read' }, 'req_1');

    expect(auditService.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ servedFromCache: false, matchedPolicies: [], decision: 'allow' }),
    );
  });

  it('records an audit event even for unknown_user, before any cache lookup happens', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(null) });
    const auditService = makeMockAuditService();
    const decisionCache = makeMockDecisionCache();
    const engine = new DecisionEngineService(
      userRepo,
      makeMockRbacRepository(),
      makeMockTenantRepo(),
      decisionCache,
      new PolicyEvaluationService(makeEmptyPolicyRepo()),
      auditService as never,
      makeMockConfigService() as never,
    );

    await engine.evaluate('tenant_a', { userId: 'ext_ghost', action: 'projects:read' }, 'req_1');

    expect(auditService.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'unknown_user', decision: 'deny' }),
    );
    expect(decisionCache.get).not.toHaveBeenCalled();
  });

  it('includes the requestId passed into evaluate() in the audit event', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const auditService = makeMockAuditService();
    const engine = new DecisionEngineService(
      userRepo,
      makeMockRbacRepository(),
      makeMockTenantRepo(),
      makeMockDecisionCache({ get: jest.fn().mockResolvedValue({ allowed: true, reason: 'role_permission' }) }),
      new PolicyEvaluationService(makeEmptyPolicyRepo()),
      auditService as never,
      makeMockConfigService() as never,
    );

    await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'projects:read' }, 'req_unique_123');

    expect(auditService.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req_unique_123' }),
    );
  });
});

describe('DecisionEngineService - defense in depth: cache/audit failures never affect the returned decision', () => {
  it('still returns the correct decision when decisionCache.set rejects', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_admin']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['projects:read']),
    });
    const decisionCache = makeMockDecisionCache({ set: jest.fn().mockRejectedValue(new Error('redis down')) });
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      decisionCache,
      new PolicyEvaluationService(makeEmptyPolicyRepo()),
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'projects:read' }, 'req_1');

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('role_permission');
  });

  it('still returns the correct decision when the audit service rejects unexpectedly', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_admin']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['projects:read']),
    });
    const brokenAudit = { recordDecision: jest.fn().mockRejectedValue(new Error('postgres down')) };
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      new PolicyEvaluationService(makeEmptyPolicyRepo()),
      brokenAudit as never,
      makeMockConfigService() as never,
    );

    const decision = await engine.evaluate('tenant_a', { userId: 'ext_alice', action: 'projects:read' }, 'req_1');

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('role_permission');
  });

  it('a broken audit service never causes evaluate() to reject', async () => {
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(null) });
    const brokenAudit = { recordDecision: jest.fn().mockRejectedValue(new Error('boom')) };
    const engine = new DecisionEngineService(
      userRepo,
      makeMockRbacRepository(),
      makeMockTenantRepo(),
      makeMockDecisionCache(),
      new PolicyEvaluationService(makeEmptyPolicyRepo()),
      brokenAudit as never,
      makeMockConfigService() as never,
    );

    await expect(
      engine.evaluate('tenant_a', { userId: 'ext_ghost', action: 'projects:read' }, 'req_1'),
    ).resolves.toEqual({ allowed: false, reason: 'unknown_user' });
  });
});

describe('DecisionEngineService - end-to-end version-bump cache invalidation (real cache-key builder + in-memory store)', () => {
  it('SECURITY: a tenant authz version bump makes a previously cached ALLOW unreachable and re-evaluates fresh (previous ALLOW -> current DENY cannot return stale)', async () => {
    const user = makeUser();
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(user) });
    let tenantVersion = 1;
    const tenantRepo = makeMockTenantRepo({ getAuthzVersion: jest.fn((_tenantId: string) => Promise.resolve(tenantVersion)) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_admin']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['projects:read']),
    });
    const cache = new FakeInMemoryDecisionCache();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      tenantRepo,
      cache,
      new PolicyEvaluationService(makeEmptyPolicyRepo()),
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const firstDecision = await engine.evaluate(
      'tenant_a',
      { userId: 'ext_alice', action: 'projects:read' },
      'req_1',
    );
    expect(firstDecision.allowed).toBe(true);
    expect(cache.size()).toBe(1);

    rbacRepo.getEffectivePermissionActions.mockClear();
    const secondDecision = await engine.evaluate(
      'tenant_a',
      { userId: 'ext_alice', action: 'projects:read' },
      'req_2',
    );
    expect(secondDecision.allowed).toBe(true);
    expect(rbacRepo.getEffectivePermissionActions).not.toHaveBeenCalled();

    tenantVersion = 2;
    rbacRepo.getEffectivePermissionActions.mockResolvedValue([]);

    const thirdDecision = await engine.evaluate(
      'tenant_a',
      { userId: 'ext_alice', action: 'projects:read' },
      'req_3',
    );

    expect(thirdDecision.allowed).toBe(false);
    expect(thirdDecision.reason).toBe('no_matching_permission');
    expect(rbacRepo.getEffectivePermissionActions).toHaveBeenCalled();
  });

  it('SECURITY: a tenant authz version bump also lets a previous DENY become ALLOW once the underlying state actually changed', async () => {
    const user = makeUser();
    const userRepo = makeUserRepo({ findByExternalId: jest.fn().mockResolvedValue(user) });
    let tenantVersion = 1;
    const tenantRepo = makeMockTenantRepo({ getAuthzVersion: jest.fn((_tenantId: string) => Promise.resolve(tenantVersion)) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_member']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue([]),
    });
    const cache = new FakeInMemoryDecisionCache();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      tenantRepo,
      cache,
      new PolicyEvaluationService(makeEmptyPolicyRepo()),
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    const firstDecision = await engine.evaluate(
      'tenant_a',
      { userId: 'ext_alice', action: 'projects:read' },
      'req_1',
    );
    expect(firstDecision.allowed).toBe(false);

    tenantVersion = 2;
    rbacRepo.getEffectivePermissionActions.mockResolvedValue(['projects:read']);

    const secondDecision = await engine.evaluate(
      'tenant_a',
      { userId: 'ext_alice', action: 'projects:read' },
      'req_2',
    );

    expect(secondDecision.allowed).toBe(true);
  });

  it('a USER-scoped version bump invalidates only that user, not the whole tenant cache', async () => {
    const userA = makeUser({ id: 'u_a', externalId: 'ext_a', authzVersion: 1 });
    const userB = makeUser({ id: 'u_b', externalId: 'ext_b', authzVersion: 1 });
    const userRepo = makeUserRepo({
      findByExternalId: jest.fn((_t: string, externalId: string) =>
        Promise.resolve(externalId === 'ext_a' ? userA : userB),
      ),
    });
    const tenantRepo = makeMockTenantRepo({ getAuthzVersion: jest.fn().mockResolvedValue(1) });
    const rbacRepo = makeMockRbacRepository({
      listRoleIdsForUser: jest.fn().mockResolvedValue(['role_admin']),
      getEffectivePermissionActions: jest.fn().mockResolvedValue(['projects:read']),
    });
    const cache = new FakeInMemoryDecisionCache();
    const engine = new DecisionEngineService(
      userRepo,
      rbacRepo,
      tenantRepo,
      cache,
      new PolicyEvaluationService(makeEmptyPolicyRepo()),
      makeMockAuditService() as never,
      makeMockConfigService() as never,
    );

    await engine.evaluate('tenant_a', { userId: 'ext_a', action: 'projects:read' }, 'req_1');
    await engine.evaluate('tenant_a', { userId: 'ext_b', action: 'projects:read' }, 'req_2');
    expect(cache.size()).toBe(2);

    userA.authzVersion = 2;
    rbacRepo.getEffectivePermissionActions.mockResolvedValue([]);

    rbacRepo.listRoleIdsForUser.mockClear();
    const decisionForA = await engine.evaluate('tenant_a', { userId: 'ext_a', action: 'projects:read' }, 'req_3');
    const decisionForB = await engine.evaluate('tenant_a', { userId: 'ext_b', action: 'projects:read' }, 'req_4');

    expect(decisionForA.allowed).toBe(false);
    expect(decisionForB.allowed).toBe(true);
  });
});
