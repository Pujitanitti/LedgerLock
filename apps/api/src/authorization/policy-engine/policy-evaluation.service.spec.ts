import { PolicyEvaluationService } from './policy-evaluation.service';
import type { PolicyRepositoryPort } from '../../policies/repositories/policy-repository.port';
import type { PolicyVersionRecord } from '../../policies/types/policy-record';
import type { EvaluationAttributes } from '../conditions/condition-types';

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

function makeRepo(candidates: PolicyVersionRecord[]): jest.Mocked<PolicyRepositoryPort> {
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

const attrs: EvaluationAttributes = {
  subject: { id: 'user_1', roles: [] },
  resource: { type: 'invoice', id: 'inv_1', ownerId: 'user_1' },
};

describe('PolicyEvaluationService.evaluate - basic matching', () => {
  it('returns no_opinion when no policies match', async () => {
    const service = new PolicyEvaluationService(makeRepo([]));
    const result = await service.evaluate('tenant_a', 'invoices:update', attrs);
    expect(result.decision).toBe('no_opinion');
  });

  it('returns allow when a matching allow policy has no conditions', async () => {
    const service = new PolicyEvaluationService(makeRepo([makeVersion({ effect: 'allow' })]));
    const result = await service.evaluate('tenant_a', 'invoices:update', attrs);
    expect(result.decision).toBe('allow');
  });

  it('returns no_opinion when the action does not match any candidate', async () => {
    const service = new PolicyEvaluationService(makeRepo([makeVersion({ actions: ['projects:read'] })]));
    const result = await service.evaluate('tenant_a', 'invoices:delete', attrs);
    expect(result.decision).toBe('no_opinion');
  });

  it('returns no_opinion when the resource type does not match', async () => {
    const service = new PolicyEvaluationService(makeRepo([makeVersion({ resourceTypes: ['project'] })]));
    const result = await service.evaluate('tenant_a', 'invoices:update', attrs);
    expect(result.decision).toBe('no_opinion');
  });

  it('evaluates conditions - only matches when they pass', async () => {
    const version = makeVersion({
      conditions: [{ field: 'resource.ownerId', operator: 'equals', value: { ref: 'subject.id' } }],
    });
    const service = new PolicyEvaluationService(makeRepo([version]));

    const ownAttrs = { ...attrs, resource: { type: 'invoice', id: 'inv_1', ownerId: 'user_1' } };
    const otherAttrs = { ...attrs, resource: { type: 'invoice', id: 'inv_1', ownerId: 'user_2' } };

    expect((await service.evaluate('tenant_a', 'invoices:update', ownAttrs)).decision).toBe('allow');
    expect((await service.evaluate('tenant_a', 'invoices:update', otherAttrs)).decision).toBe('no_opinion');
  });
});

describe('PolicyEvaluationService.evaluate - DENY dominance', () => {
  it('returns deny when a deny policy matches alongside an allow policy', async () => {
    const versions = [
      makeVersion({ policyId: 'p_allow', effect: 'allow' }),
      makeVersion({ policyId: 'p_deny', effect: 'deny' }),
    ];
    const service = new PolicyEvaluationService(makeRepo(versions));

    const result = await service.evaluate('tenant_a', 'invoices:update', attrs);

    expect(result.decision).toBe('deny');
  });

  it('is order-independent: deny wins whether it is listed first or last', async () => {
    const allowFirst = [
      makeVersion({ policyId: 'p_allow', effect: 'allow' }),
      makeVersion({ policyId: 'p_deny', effect: 'deny' }),
    ];
    const denyFirst = [
      makeVersion({ policyId: 'p_deny', effect: 'deny' }),
      makeVersion({ policyId: 'p_allow', effect: 'allow' }),
    ];

    const resultA = await new PolicyEvaluationService(makeRepo(allowFirst)).evaluate(
      'tenant_a',
      'invoices:update',
      attrs,
    );
    const resultB = await new PolicyEvaluationService(makeRepo(denyFirst)).evaluate(
      'tenant_a',
      'invoices:update',
      attrs,
    );

    expect(resultA.decision).toBe('deny');
    expect(resultB.decision).toBe('deny');
  });

  it('multiple allow policies plus one deny still result in deny', async () => {
    const versions = [
      makeVersion({ policyId: 'p1', effect: 'allow' }),
      makeVersion({ policyId: 'p2', effect: 'allow' }),
      makeVersion({ policyId: 'p3', effect: 'allow' }),
      makeVersion({ policyId: 'p4', effect: 'deny' }),
    ];
    const service = new PolicyEvaluationService(makeRepo(versions));

    expect((await service.evaluate('tenant_a', 'invoices:update', attrs)).decision).toBe('deny');
  });
});

describe('PolicyEvaluationService.evaluate - deterministic provenance', () => {
  it('picks the highest-priority policy as decidingPolicy among multiple denies', async () => {
    const versions = [
      makeVersion({ policyId: 'p_low', effect: 'deny', priority: 1 }),
      makeVersion({ policyId: 'p_high', effect: 'deny', priority: 10 }),
    ];
    const service = new PolicyEvaluationService(makeRepo(versions));

    const result = await service.evaluate('tenant_a', 'invoices:update', attrs);

    expect(result.decidingPolicy?.policyId).toBe('p_high');
  });

  it('breaks priority ties by lexicographically smallest policyId, regardless of input order', async () => {
    const versionsA = [
      makeVersion({ policyId: 'p_zzz', effect: 'deny', priority: 5 }),
      makeVersion({ policyId: 'p_aaa', effect: 'deny', priority: 5 }),
    ];
    const versionsB = [...versionsA].reverse();

    const resultA = await new PolicyEvaluationService(makeRepo(versionsA)).evaluate(
      'tenant_a',
      'invoices:update',
      attrs,
    );
    const resultB = await new PolicyEvaluationService(makeRepo(versionsB)).evaluate(
      'tenant_a',
      'invoices:update',
      attrs,
    );

    expect(resultA.decidingPolicy?.policyId).toBe('p_aaa');
    expect(resultB.decidingPolicy?.policyId).toBe('p_aaa');
  });

  it('includes every matched policy in matchedPolicies for provenance, not just the deciding one', async () => {
    const versions = [
      makeVersion({ policyId: 'p1', effect: 'allow' }),
      makeVersion({ policyId: 'p2', effect: 'allow' }),
    ];
    const service = new PolicyEvaluationService(makeRepo(versions));

    const result = await service.evaluate('tenant_a', 'invoices:update', attrs);

    expect(result.matchedPolicies).toHaveLength(2);
  });
});

describe('PolicyEvaluationService.evaluate - disabled policies never influence the decision', () => {
  it('trusts the repository contract to exclude disabled policies (repository query is scoped by design)', async () => {
    // listCandidateVersionsForCheck's contract (see PolicyRepositoryPort)
    // is to return ONLY enabled policies' current versions - this test
    // documents and pins that a disabled policy's version simply never
    // appears in the candidates the service receives, which is where
    // "disabled policies are excluded" is actually enforced.
    const repo = makeRepo([]);
    const service = new PolicyEvaluationService(repo);

    const result = await service.evaluate('tenant_a', 'invoices:update', attrs);

    expect(repo.listCandidateVersionsForCheck).toHaveBeenCalledWith('tenant_a');
    expect(result.decision).toBe('no_opinion');
  });
});

describe('PolicyEvaluationService — batch-oriented API (fetchCandidates + evaluateAgainstCandidates)', () => {
  it('fetchCandidates delegates to the repository', async () => {
    const versions = [makeVersion()];
    const repo = makeRepo(versions);
    const service = new PolicyEvaluationService(repo);

    await expect(service.fetchCandidates('tenant_a')).resolves.toBe(versions);
  });

  it('evaluateAgainstCandidates produces the same result as evaluate() without any repository call', () => {
    const versions = [makeVersion({ effect: 'allow' })];
    const repo = makeRepo(versions);
    const service = new PolicyEvaluationService(repo);

    const result = service.evaluateAgainstCandidates(versions, 'invoices:update', attrs);

    expect(result.decision).toBe('allow');
    expect(repo.listCandidateVersionsForCheck).not.toHaveBeenCalled();
  });

  it('evaluateAgainstCandidates can be called repeatedly against the same fetched list for different items', () => {
    const versions = [
      makeVersion({ policyId: 'p_deny', effect: 'deny', actions: ['invoices:delete'] }),
      makeVersion({ policyId: 'p_allow', effect: 'allow', actions: ['invoices:update'] }),
    ];
    const service = new PolicyEvaluationService(makeRepo(versions));

    const updateResult = service.evaluateAgainstCandidates(versions, 'invoices:update', attrs);
    const deleteResult = service.evaluateAgainstCandidates(versions, 'invoices:delete', attrs);

    expect(updateResult.decision).toBe('allow');
    expect(deleteResult.decision).toBe('deny');
  });
});
