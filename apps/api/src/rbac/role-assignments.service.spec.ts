import { NotFoundException } from '@nestjs/common';
import { RoleAssignmentsService } from './role-assignments.service';
import { RolesService } from './roles.service';
import { PermissionsService } from './permissions.service';
import { makeMockRbacRepository } from './test-utils/mock-rbac-repository';
import { makeMockAuthzVersion } from '../authorization/authz-version/test-utils/mock-authz-version';
import type { UserRepositoryPort } from '../users/repositories/user-repository.port';
import type { RoleRecord, PermissionRecord } from './types/rbac-record';
import type { UserRecord } from '../users/types/user-record';

function makeRole(overrides: Partial<RoleRecord> = {}): RoleRecord {
  return { id: 'role_1', tenantId: 'tenant_a', name: 'Admin', createdAt: new Date(), ...overrides };
}

function makePermission(overrides: Partial<PermissionRecord> = {}): PermissionRecord {
  return { id: 'perm_1', tenantId: 'tenant_a', action: 'projects:read', createdAt: new Date(), ...overrides };
}

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user_1',
    tenantId: 'tenant_a',
    externalId: 'ext_1',
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

describe('RoleAssignmentsService — role <-> permission', () => {
  it('assigns a permission to a role when both belong to the tenant', async () => {
    const rbacRepo = makeMockRbacRepository({
      findRoleById: jest.fn().mockResolvedValue(makeRole()),
      findPermissionById: jest.fn().mockResolvedValue(makePermission()),
    });
    const userRepo = makeUserRepo();
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleAssignmentsService(
      rbacRepo,
      new RolesService(rbacRepo, authzVersion),
      new PermissionsService(rbacRepo, authzVersion),
      userRepo,
      authzVersion,
    );

    await service.assignPermissionToRole('tenant_a', 'role_1', 'perm_1');

    expect(rbacRepo.assignPermissionToRole).toHaveBeenCalledWith('tenant_a', 'role_1', 'perm_1');
  });

  it('bumps the TENANT authz version (not user-scoped) after role<->permission assignment', async () => {
    const rbacRepo = makeMockRbacRepository({
      findRoleById: jest.fn().mockResolvedValue(makeRole()),
      findPermissionById: jest.fn().mockResolvedValue(makePermission()),
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleAssignmentsService(
      rbacRepo,
      new RolesService(rbacRepo, authzVersion),
      new PermissionsService(rbacRepo, authzVersion),
      makeUserRepo(),
      authzVersion,
    );

    await service.assignPermissionToRole('tenant_a', 'role_1', 'perm_1');

    expect(authzVersion.bumpTenant).toHaveBeenCalledWith('tenant_a');
    expect(authzVersion.bumpUser).not.toHaveBeenCalled();
  });

  it('SECURITY: refuses to assign a permission when the role belongs to a different tenant', async () => {
    const rbacRepo = makeMockRbacRepository({
      findRoleById: jest.fn().mockResolvedValue(null), // tenant_b querying tenant_a's role
      findPermissionById: jest.fn().mockResolvedValue(makePermission({ tenantId: 'tenant_b' })),
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleAssignmentsService(
      rbacRepo,
      new RolesService(rbacRepo, authzVersion),
      new PermissionsService(rbacRepo, authzVersion),
      makeUserRepo(),
      authzVersion,
    );

    await expect(
      service.assignPermissionToRole('tenant_b', 'role_belonging_to_tenant_a', 'perm_1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(rbacRepo.assignPermissionToRole).not.toHaveBeenCalled();
  });

  it('SECURITY: refuses to assign when the permission belongs to a different tenant, even if the role is valid', async () => {
    const rbacRepo = makeMockRbacRepository({
      findRoleById: jest.fn().mockResolvedValue(makeRole({ tenantId: 'tenant_b' })),
      findPermissionById: jest.fn().mockResolvedValue(null), // permission belongs to tenant_a
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleAssignmentsService(
      rbacRepo,
      new RolesService(rbacRepo, authzVersion),
      new PermissionsService(rbacRepo, authzVersion),
      makeUserRepo(),
      authzVersion,
    );

    await expect(
      service.assignPermissionToRole('tenant_b', 'role_1', 'perm_belonging_to_tenant_a'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(rbacRepo.assignPermissionToRole).not.toHaveBeenCalled();
  });
});

describe('RoleAssignmentsService — user <-> role', () => {
  it('assigns a role to a user when both belong to the tenant', async () => {
    const rbacRepo = makeMockRbacRepository({ findRoleById: jest.fn().mockResolvedValue(makeRole()) });
    const userRepo = makeUserRepo({ findById: jest.fn().mockResolvedValue(makeUser()) });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleAssignmentsService(
      rbacRepo,
      new RolesService(rbacRepo, authzVersion),
      new PermissionsService(rbacRepo, authzVersion),
      userRepo,
      authzVersion,
    );

    await service.assignRoleToUser('tenant_a', 'user_1', 'role_1');

    expect(rbacRepo.assignRoleToUser).toHaveBeenCalledWith('tenant_a', 'user_1', 'role_1');
  });

  it('bumps only the USER authz version (not the tenant) after user<->role assignment', async () => {
    const rbacRepo = makeMockRbacRepository({ findRoleById: jest.fn().mockResolvedValue(makeRole()) });
    const userRepo = makeUserRepo({ findById: jest.fn().mockResolvedValue(makeUser()) });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleAssignmentsService(
      rbacRepo,
      new RolesService(rbacRepo, authzVersion),
      new PermissionsService(rbacRepo, authzVersion),
      userRepo,
      authzVersion,
    );

    await service.assignRoleToUser('tenant_a', 'user_1', 'role_1');

    expect(authzVersion.bumpUser).toHaveBeenCalledWith('tenant_a', 'user_1');
    expect(authzVersion.bumpTenant).not.toHaveBeenCalled();
  });

  it('SECURITY: refuses to assign a role to a user from a different tenant', async () => {
    const rbacRepo = makeMockRbacRepository({ findRoleById: jest.fn().mockResolvedValue(makeRole()) });
    const userRepo = makeUserRepo({ findById: jest.fn().mockResolvedValue(null) });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleAssignmentsService(
      rbacRepo,
      new RolesService(rbacRepo, authzVersion),
      new PermissionsService(rbacRepo, authzVersion),
      userRepo,
      authzVersion,
    );

    await expect(
      service.assignRoleToUser('tenant_b', 'user_belonging_to_tenant_a', 'role_1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(rbacRepo.assignRoleToUser).not.toHaveBeenCalled();
  });

  it('SECURITY: refuses to assign a cross-tenant role even to a valid same-tenant user', async () => {
    const rbacRepo = makeMockRbacRepository({ findRoleById: jest.fn().mockResolvedValue(null) });
    const userRepo = makeUserRepo({ findById: jest.fn().mockResolvedValue(makeUser()) });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleAssignmentsService(
      rbacRepo,
      new RolesService(rbacRepo, authzVersion),
      new PermissionsService(rbacRepo, authzVersion),
      userRepo,
      authzVersion,
    );

    await expect(
      service.assignRoleToUser('tenant_a', 'user_1', 'role_belonging_to_tenant_b'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(rbacRepo.assignRoleToUser).not.toHaveBeenCalled();
  });

  it('removeRoleFromUser also verifies both entities before removing', async () => {
    const rbacRepo = makeMockRbacRepository({ findRoleById: jest.fn().mockResolvedValue(makeRole()) });
    const userRepo = makeUserRepo({ findById: jest.fn().mockResolvedValue(makeUser()) });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleAssignmentsService(
      rbacRepo,
      new RolesService(rbacRepo, authzVersion),
      new PermissionsService(rbacRepo, authzVersion),
      userRepo,
      authzVersion,
    );

    await service.removeRoleFromUser('tenant_a', 'user_1', 'role_1');

    expect(rbacRepo.removeRoleFromUser).toHaveBeenCalledWith('tenant_a', 'user_1', 'role_1');
  });

  it('R-002: passes tenantId through to removePermissionFromRole for query-level defense-in-depth', async () => {
    const rbacRepo = makeMockRbacRepository({
      findRoleById: jest.fn().mockResolvedValue(makeRole()),
      findPermissionById: jest.fn().mockResolvedValue(makePermission()),
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleAssignmentsService(
      rbacRepo,
      new RolesService(rbacRepo, authzVersion),
      new PermissionsService(rbacRepo, authzVersion),
      makeUserRepo(),
      authzVersion,
    );

    await service.removePermissionFromRole('tenant_a', 'role_1', 'perm_1');

    expect(rbacRepo.removePermissionFromRole).toHaveBeenCalledWith('tenant_a', 'role_1', 'perm_1');
  });

  it('R-002: passes tenantId through to removeRoleFromUser for query-level defense-in-depth', async () => {
    const rbacRepo = makeMockRbacRepository({ findRoleById: jest.fn().mockResolvedValue(makeRole()) });
    const userRepo = makeUserRepo({ findById: jest.fn().mockResolvedValue(makeUser()) });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleAssignmentsService(
      rbacRepo,
      new RolesService(rbacRepo, authzVersion),
      new PermissionsService(rbacRepo, authzVersion),
      userRepo,
      authzVersion,
    );

    await service.removeRoleFromUser('tenant_a', 'user_1', 'role_1');

    expect(rbacRepo.removeRoleFromUser).toHaveBeenCalledWith('tenant_a', 'user_1', 'role_1');
  });
});
