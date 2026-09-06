import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import type { UserRepositoryPort } from './repositories/user-repository.port';
import type { UserRecord } from './types/user-record';

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user_1',
    tenantId: 'tenant_a',
    externalId: 'ext_123',
    authzVersion: 1,
    attributes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRepository(overrides: Partial<jest.Mocked<UserRepositoryPort>> = {}): jest.Mocked<UserRepositoryPort> {
  return {
    create: jest.fn(),
    findByExternalId: jest.fn(),
    findById: jest.fn(),
    findManyByExternalIds: jest.fn(),
    list: jest.fn(),
    ...overrides,
  } as jest.Mocked<UserRepositoryPort>;
}

describe('UsersService.create', () => {
  it('creates a user when the externalId is not already taken for this tenant', async () => {
    const repo = makeRepository({
      findByExternalId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((input) => Promise.resolve(makeUser(input))),
    });
    const service = new UsersService(repo);

    const user = await service.create('tenant_a', 'ext_123');

    expect(repo.create).toHaveBeenCalledWith({ tenantId: 'tenant_a', externalId: 'ext_123', attributes: undefined });
    expect(user.externalId).toBe('ext_123');
  });

  it('rejects a duplicate externalId within the same tenant', async () => {
    const repo = makeRepository({ findByExternalId: jest.fn().mockResolvedValue(makeUser()) });
    const service = new UsersService(repo);

    await expect(service.create('tenant_a', 'ext_123')).rejects.toBeInstanceOf(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('checks for duplicates scoped to the given tenant', async () => {
    const repo = makeRepository({
      findByExternalId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((input) => Promise.resolve(makeUser(input))),
    });
    const service = new UsersService(repo);

    await service.create('tenant_b', 'ext_123');

    expect(repo.findByExternalId).toHaveBeenCalledWith('tenant_b', 'ext_123');
  });
});

describe('UsersService.getById', () => {
  it('returns the user when found within the tenant', async () => {
    const user = makeUser();
    const repo = makeRepository({ findById: jest.fn().mockResolvedValue(user) });
    const service = new UsersService(repo);

    await expect(service.getById('tenant_a', 'user_1')).resolves.toBe(user);
  });

  it('throws NotFoundException when the user does not exist for this tenant (including cross-tenant lookups)', async () => {
    const repo = makeRepository({ findById: jest.fn().mockResolvedValue(null) });
    const service = new UsersService(repo);

    await expect(service.getById('tenant_b', 'user_belonging_to_tenant_a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('UsersService.list', () => {
  it('delegates to the repository scoped by tenant', async () => {
    const users = [makeUser({ id: 'u1' }), makeUser({ id: 'u2' })];
    const repo = makeRepository({ list: jest.fn().mockResolvedValue(users) });
    const service = new UsersService(repo);

    await expect(service.list('tenant_a')).resolves.toBe(users);
    expect(repo.list).toHaveBeenCalledWith('tenant_a');
  });
});
