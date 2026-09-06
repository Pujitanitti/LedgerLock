import { NotFoundException } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { makeMockAuthzVersion } from '../authorization/authz-version/test-utils/mock-authz-version';
import type { RbacRepositoryPort } from './repositories/rbac-repository.port';
import type { PermissionRecord } from './types/rbac-record';

function makePermission(overrides: Partial<PermissionRecord> = {}): PermissionRecord {
  return {
    id: 'perm_1',
    tenantId: 'tenant_a',
    action: 'projects:read',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<jest.Mocked<RbacRepositoryPort>> = {}): jest.Mocked<RbacRepositoryPort> {
  return {
    createRole: jest.fn(),
    findRoleById: jest.fn(),
    listRoles: jest.fn(),
    deleteRole: jest.fn(),
    upsertPermission: jest.fn(),
    findPermissionById: jest.fn(),
    listPermissions: jest.fn(),
    assignPermissionToRole: jest.fn(),
    removePermissionFromRole: jest.fn(),
    listPermissionActionsForRoles: jest.fn(),
    assignRoleToUser: jest.fn(),
    removeRoleFromUser: jest.fn(),
    listRoleIdsForUser: jest.fn(),
    listInheritanceEdges: jest.fn(),
    addInheritanceEdge: jest.fn(),
    getEffectivePermissionActions: jest.fn(),
    ...overrides,
  } as jest.Mocked<RbacRepositoryPort>;
}

describe('PermissionsService', () => {
  it('createOrGet delegates to the idempotent upsert', async () => {
    const permission = makePermission();
    const repo = makeRepo({ upsertPermission: jest.fn().mockResolvedValue(permission) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PermissionsService(repo, authzVersion);

    await expect(service.createOrGet('tenant_a', 'projects:read')).resolves.toBe(permission);
    expect(repo.upsertPermission).toHaveBeenCalledWith('tenant_a', 'projects:read');
  });

  it('bumps the tenant authz version after createOrGet', async () => {
    const repo = makeRepo({ upsertPermission: jest.fn().mockResolvedValue(makePermission()) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PermissionsService(repo, authzVersion);

    await service.createOrGet('tenant_a', 'projects:read');

    expect(authzVersion.bumpTenant).toHaveBeenCalledWith('tenant_a');
  });

  it('getById throws NotFoundException for a cross-tenant permission ID', async () => {
    const repo = makeRepo({ findPermissionById: jest.fn().mockResolvedValue(null) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PermissionsService(repo, authzVersion);

    await expect(service.getById('tenant_b', 'perm_belonging_to_tenant_a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('list delegates to the repository scoped by tenant', async () => {
    const permissions = [makePermission({ id: 'p1' }), makePermission({ id: 'p2' })];
    const repo = makeRepo({ listPermissions: jest.fn().mockResolvedValue(permissions) });
    const authzVersion = makeMockAuthzVersion();
    const service = new PermissionsService(repo, authzVersion);

    await expect(service.list('tenant_a')).resolves.toBe(permissions);
  });
});
