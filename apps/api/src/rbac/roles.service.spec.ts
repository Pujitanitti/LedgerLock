import { NotFoundException } from '@nestjs/common';
import { makeMockAuthzVersion } from '../authorization/authz-version/test-utils/mock-authz-version';
import { RolesService } from './roles.service';
import type { RbacRepositoryPort } from './repositories/rbac-repository.port';
import type { RoleRecord } from './types/rbac-record';

function makeRole(overrides: Partial<RoleRecord> = {}): RoleRecord {
  return {
    id: 'role_1',
    tenantId: 'tenant_a',
    name: 'Admin',
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

describe('RolesService', () => {
  it('creates a role scoped to the tenant', async () => {
    const repo = makeRepo({ createRole: jest.fn().mockImplementation((t, n) => Promise.resolve(makeRole({ tenantId: t, name: n }))) });
    const authzVersion = makeMockAuthzVersion();
    const service = new RolesService(repo, authzVersion);

    const role = await service.create('tenant_a', 'Admin');

    expect(repo.createRole).toHaveBeenCalledWith('tenant_a', 'Admin');
    expect(role.name).toBe('Admin');
  });

  it('bumps the tenant authz version after creating a role', async () => {
    const repo = makeRepo({ createRole: jest.fn().mockResolvedValue(makeRole()) });
    const authzVersion = makeMockAuthzVersion();
    const service = new RolesService(repo, authzVersion);

    await service.create('tenant_a', 'Admin');

    expect(authzVersion.bumpTenant).toHaveBeenCalledWith('tenant_a');
  });

  it('getById returns the role when it belongs to the tenant', async () => {
    const role = makeRole();
    const repo = makeRepo({ findRoleById: jest.fn().mockResolvedValue(role) });
    const authzVersion = makeMockAuthzVersion();
    const service = new RolesService(repo, authzVersion);

    await expect(service.getById('tenant_a', 'role_1')).resolves.toBe(role);
  });

  it('getById throws NotFoundException for a cross-tenant role ID', async () => {
    const repo = makeRepo({ findRoleById: jest.fn().mockResolvedValue(null) });
    const authzVersion = makeMockAuthzVersion();
    const service = new RolesService(repo, authzVersion);

    await expect(service.getById('tenant_b', 'role_belonging_to_tenant_a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.findRoleById).toHaveBeenCalledWith('tenant_b', 'role_belonging_to_tenant_a');
  });

  it('delete verifies existence/ownership before deleting', async () => {
    const role = makeRole();
    const repo = makeRepo({ findRoleById: jest.fn().mockResolvedValue(role) });
    const authzVersion = makeMockAuthzVersion();
    const service = new RolesService(repo, authzVersion);

    await service.delete('tenant_a', 'role_1');

    expect(repo.deleteRole).toHaveBeenCalledWith('tenant_a', 'role_1');
  });

  it('bumps the tenant authz version after deleting a role', async () => {
    const repo = makeRepo({ findRoleById: jest.fn().mockResolvedValue(makeRole()) });
    const authzVersion = makeMockAuthzVersion();
    const service = new RolesService(repo, authzVersion);

    await service.delete('tenant_a', 'role_1');

    expect(authzVersion.bumpTenant).toHaveBeenCalledWith('tenant_a');
  });

  it('does NOT bump the tenant authz version when delete fails ownership check', async () => {
    const repo = makeRepo({ findRoleById: jest.fn().mockResolvedValue(null) });
    const authzVersion = makeMockAuthzVersion();
    const service = new RolesService(repo, authzVersion);

    await expect(service.delete('tenant_b', 'role_belonging_to_tenant_a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(authzVersion.bumpTenant).not.toHaveBeenCalled();
  });

  it('delete refuses (via NotFoundException) to touch a role from another tenant', async () => {
    const repo = makeRepo({ findRoleById: jest.fn().mockResolvedValue(null) });
    const authzVersion = makeMockAuthzVersion();
    const service = new RolesService(repo, authzVersion);

    await expect(service.delete('tenant_b', 'role_belonging_to_tenant_a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.deleteRole).not.toHaveBeenCalled();
  });

  it('list delegates to the repository scoped by tenant', async () => {
    const roles = [makeRole({ id: 'r1' }), makeRole({ id: 'r2' })];
    const repo = makeRepo({ listRoles: jest.fn().mockResolvedValue(roles) });
    const authzVersion = makeMockAuthzVersion();
    const service = new RolesService(repo, authzVersion);

    await expect(service.list('tenant_a')).resolves.toBe(roles);
    expect(repo.listRoles).toHaveBeenCalledWith('tenant_a');
  });

  it('ROLLBACK BEHAVIOR: if the version bump fails after the mutation succeeds, the whole operation fails loudly rather than silently succeeding with a stale cache', async () => {
    // KNOWN LIMITATION (documented in ADR-012): the role creation and the
    // authzVersion bump are two separate, sequential Prisma operations,
    // not wrapped in a single cross-repository transaction. If the bump
    // fails after the role was already committed, the role DOES persist
    // in the database even though this call rejects — a genuine residual
    // atomicity gap. What this test proves is the SAFER half of that
    // gap: the caller is never told the operation succeeded when the
    // version wasn't actually bumped, which is what would let a cached
    // decision remain incorrectly "valid" without anyone knowing.
    const repo = makeRepo({ createRole: jest.fn().mockResolvedValue(makeRole()) });
    const authzVersion = makeMockAuthzVersion({
      bumpTenant: jest.fn().mockRejectedValue(new Error('version bump failed')),
    });
    const service = new RolesService(repo, authzVersion);

    await expect(service.create('tenant_a', 'Admin')).rejects.toThrow('version bump failed');
  });
});
