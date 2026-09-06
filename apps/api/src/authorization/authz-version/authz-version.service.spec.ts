import { AuthzVersionService } from './authz-version.service';
import type { TenantRepositoryPort } from '../../tenants/repositories/tenant-repository.port';
import type { UserRepositoryPort } from '../../users/repositories/user-repository.port';

function makeTenantRepo(overrides: Partial<jest.Mocked<TenantRepositoryPort>> = {}): jest.Mocked<TenantRepositoryPort> {
  return {
    create: jest.fn(),
    findBySlug: jest.fn(),
    findById: jest.fn(),
    getAuthzVersion: jest.fn(),
    incrementAuthzVersion: jest.fn(),
    ...overrides,
  } as jest.Mocked<TenantRepositoryPort>;
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

describe('AuthzVersionService', () => {
  it('bumpTenant delegates to the tenant repository', async () => {
    const tenantRepo = makeTenantRepo();
    const service = new AuthzVersionService(tenantRepo, makeUserRepo());

    await service.bumpTenant('tenant_a');

    expect(tenantRepo.incrementAuthzVersion).toHaveBeenCalledWith('tenant_a');
  });

  it('bumpUser delegates to the user repository, scoped by tenant', async () => {
    const userRepo = makeUserRepo();
    const service = new AuthzVersionService(makeTenantRepo(), userRepo);

    await service.bumpUser('tenant_a', 'user_1');

    expect(userRepo.incrementAuthzVersion).toHaveBeenCalledWith('tenant_a', 'user_1');
  });

  it('bumpTenant never touches the user repository', async () => {
    const userRepo = makeUserRepo();
    const service = new AuthzVersionService(makeTenantRepo(), userRepo);

    await service.bumpTenant('tenant_a');

    expect(userRepo.incrementAuthzVersion).not.toHaveBeenCalled();
  });

  it('bumpUser never touches the tenant repository', async () => {
    const tenantRepo = makeTenantRepo();
    const service = new AuthzVersionService(tenantRepo, makeUserRepo());

    await service.bumpUser('tenant_a', 'user_1');

    expect(tenantRepo.incrementAuthzVersion).not.toHaveBeenCalled();
  });
});
