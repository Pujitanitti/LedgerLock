import { TenantsService } from './tenants.service';
import type { TenantRepositoryPort } from './repositories/tenant-repository.port';
import type { TenantRecord } from './types/tenant-record';

function makeRecord(overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    id: 'tenant_1',
    slug: 'acme',
    name: 'Acme Inc.',
    authzVersion: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRepository(overrides: Partial<jest.Mocked<TenantRepositoryPort>> = {}): jest.Mocked<TenantRepositoryPort> {
  return {
    create: jest.fn(),
    findBySlug: jest.fn(),
    findById: jest.fn(),
    ...overrides,
  } as jest.Mocked<TenantRepositoryPort>;
}

describe('TenantsService', () => {
  it('findBySlug delegates to the repository', async () => {
    const record = makeRecord();
    const repo = makeRepository({ findBySlug: jest.fn().mockResolvedValue(record) });
    const service = new TenantsService(repo);

    await expect(service.findBySlug('acme')).resolves.toBe(record);
    expect(repo.findBySlug).toHaveBeenCalledWith('acme');
  });

  it('findById delegates to the repository', async () => {
    const record = makeRecord();
    const repo = makeRepository({ findById: jest.fn().mockResolvedValue(record) });
    const service = new TenantsService(repo);

    await expect(service.findById('tenant_1')).resolves.toBe(record);
    expect(repo.findById).toHaveBeenCalledWith('tenant_1');
  });

  it('returns null when a tenant is not found, rather than throwing', async () => {
    const repo = makeRepository({ findBySlug: jest.fn().mockResolvedValue(null) });
    const service = new TenantsService(repo);

    await expect(service.findBySlug('nonexistent')).resolves.toBeNull();
  });
});
