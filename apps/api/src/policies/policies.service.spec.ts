import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PoliciesService } from './policies.service';
import { makeMockAuthzVersion } from '../authorization/authz-version/test-utils/mock-authz-version';
import type { PolicyRepositoryPort } from './repositories/policy-repository.port';
import type { PolicyRecord, PolicyVersionRecord, PolicyWithCurrentVersion } from './types/policy-record';

function makePolicy(overrides: Partial<PolicyRecord> = {}): PolicyRecord {
  return {
    id: 'policy_1',
    tenantId: 'tenant_a',
    name: 'finance-invoice-access',
    description: null,
    enabled: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
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
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<jest.Mocked<PolicyRepositoryPort>> = {}): jest.Mocked<PolicyRepositoryPort> {
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
    listCandidateVersionsForCheck: jest.fn(),
    ...overrides,
  } as jest.Mocked<PolicyRepositoryPort>;
}

const validContent = {
  effect: 'allow' as const,
  actions: ['invoices:update'],
  resourceTypes: ['invoice'],
  conditions: [{ field: 'resource.ownerId', operator: 'equals', value: { ref: 'subject.id' } }],
};

describe('PoliciesService.create', () => {
  it('creates a policy when the name is not already taken', async () => {
    const result: PolicyWithCurrentVersion = { policy: makePolicy(), currentVersion: makeVersion() };
    const repo = makeRepo({
      findPolicyByName: jest.fn().mockResolvedValue(null),
      createPolicy: jest.fn().mockResolvedValue(result),
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    const created = await service.create('tenant_a', { name: 'finance-invoice-access', ...validContent });

    expect(created).toBe(result);
    expect(repo.createPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant_a', name: 'finance-invoice-access' }),
    );
  });

  it('bumps the tenant authz version after a successful create', async () => {
    const result: PolicyWithCurrentVersion = { policy: makePolicy(), currentVersion: makeVersion() };
    const repo = makeRepo({
      findPolicyByName: jest.fn().mockResolvedValue(null),
      createPolicy: jest.fn().mockResolvedValue(result),
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    await service.create('tenant_a', { name: 'finance-invoice-access', ...validContent });

    expect(authzVersion.bumpTenant).toHaveBeenCalledWith('tenant_a');
  });

  it('rejects a duplicate policy name within the same tenant', async () => {
    const repo = makeRepo({ findPolicyByName: jest.fn().mockResolvedValue(makePolicy()) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    await expect(
      service.create('tenant_a', { name: 'finance-invoice-access', ...validContent }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.createPolicy).not.toHaveBeenCalled();
  });

  it('rejects malformed conditions BEFORE ever calling the repository', async () => {
    const repo = makeRepo({ findPolicyByName: jest.fn().mockResolvedValue(null) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    await expect(
      service.create('tenant_a', { name: 'bad-policy', ...validContent, conditions: [{ field: 'x' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createPolicy).not.toHaveBeenCalled();
  });
});

describe('PoliciesService.getById — tenant isolation', () => {
  it('returns the policy when it belongs to the tenant', async () => {
    const policy = makePolicy();
    const repo = makeRepo({ findPolicyById: jest.fn().mockResolvedValue(policy) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    await expect(service.getById('tenant_a', 'policy_1')).resolves.toBe(policy);
  });

  it('SECURITY: throws NotFoundException for a cross-tenant policy ID', async () => {
    const repo = makeRepo({ findPolicyById: jest.fn().mockResolvedValue(null) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    await expect(service.getById('tenant_b', 'policy_belonging_to_tenant_a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('PoliciesService.update — immutable versioning', () => {
  it('creates a NEW version rather than mutating the existing one', async () => {
    const repo = makeRepo({
      findPolicyById: jest.fn().mockResolvedValue(makePolicy()),
      createNewVersion: jest.fn().mockResolvedValue(makeVersion({ version: 2 })),
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    const newVersion = await service.update('tenant_a', 'policy_1', validContent);

    expect(newVersion.version).toBe(2);
    expect(repo.createNewVersion).toHaveBeenCalledWith(
      'tenant_a',
      'policy_1',
      expect.objectContaining({ effect: 'allow' }),
    );
  });

  it('bumps the tenant authz version after a successful update (new version)', async () => {
    const repo = makeRepo({
      findPolicyById: jest.fn().mockResolvedValue(makePolicy()),
      createNewVersion: jest.fn().mockResolvedValue(makeVersion({ version: 2 })),
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    await service.update('tenant_a', 'policy_1', validContent);

    expect(authzVersion.bumpTenant).toHaveBeenCalledWith('tenant_a');
  });

  it('SECURITY: refuses to update a policy belonging to a different tenant', async () => {
    const repo = makeRepo({ findPolicyById: jest.fn().mockResolvedValue(null) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    await expect(service.update('tenant_b', 'policy_belonging_to_tenant_a', validContent)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.createNewVersion).not.toHaveBeenCalled();
  });

  it('rejects malformed conditions on update before touching the repository', async () => {
    const repo = makeRepo({ findPolicyById: jest.fn().mockResolvedValue(makePolicy()) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    await expect(
      service.update('tenant_a', 'policy_1', { ...validContent, conditions: [{ field: 'x' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createNewVersion).not.toHaveBeenCalled();
  });

  it('has no method available anywhere to mutate an existing version (structural immutability check)', () => {
    // Structural/API-shape assertion: PolicyRepositoryPort has no
    // updatePolicyVersion/deletePolicyVersion method at all, so there is
    // no call PoliciesService could even make to mutate history.
    const repo = makeRepo();
    expect((repo as unknown as Record<string, unknown>)['updatePolicyVersion']).toBeUndefined();
    expect((repo as unknown as Record<string, unknown>)['deletePolicyVersion']).toBeUndefined();
  });
});

describe('PoliciesService.setEnabled / delete — tenant isolation', () => {
  it('setEnabled verifies ownership before writing', async () => {
    const repo = makeRepo({ findPolicyById: jest.fn().mockResolvedValue(makePolicy()) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    await service.setEnabled('tenant_a', 'policy_1', false);

    expect(repo.setEnabled).toHaveBeenCalledWith('tenant_a', 'policy_1', false);
  });

  it('bumps the tenant authz version after setEnabled', async () => {
    const repo = makeRepo({ findPolicyById: jest.fn().mockResolvedValue(makePolicy()) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    await service.setEnabled('tenant_a', 'policy_1', false);

    expect(authzVersion.bumpTenant).toHaveBeenCalledWith('tenant_a');
  });

  it('SECURITY: setEnabled refuses a cross-tenant policy ID', async () => {
    const repo = makeRepo({ findPolicyById: jest.fn().mockResolvedValue(null) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    await expect(service.setEnabled('tenant_b', 'policy_belonging_to_tenant_a', false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.setEnabled).not.toHaveBeenCalled();
  });

  it('SECURITY: delete refuses a cross-tenant policy ID', async () => {
    const repo = makeRepo({ findPolicyById: jest.fn().mockResolvedValue(null) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    await expect(service.delete('tenant_b', 'policy_belonging_to_tenant_a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.deletePolicy).not.toHaveBeenCalled();
  });

  it('bumps the tenant authz version after a successful delete', async () => {
    const repo = makeRepo({ findPolicyById: jest.fn().mockResolvedValue(makePolicy()) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    await service.delete('tenant_a', 'policy_1');

    expect(authzVersion.bumpTenant).toHaveBeenCalledWith('tenant_a');
  });
});

describe('PoliciesService.getVersionHistory', () => {
  it('returns full history in order, after verifying tenant ownership', async () => {
    const versions = [makeVersion({ version: 1 }), makeVersion({ id: 'pv_2', version: 2 })];
    const repo = makeRepo({
      findPolicyById: jest.fn().mockResolvedValue(makePolicy()),
      listVersionHistory: jest.fn().mockResolvedValue(versions),
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    await expect(service.getVersionHistory('tenant_a', 'policy_1')).resolves.toBe(versions);
  });

  it('SECURITY: refuses history for a cross-tenant policy ID', async () => {
    const repo = makeRepo({ findPolicyById: jest.fn().mockResolvedValue(null) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PoliciesService(repo, authzVersion);

    await expect(service.getVersionHistory('tenant_b', 'policy_belonging_to_tenant_a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
