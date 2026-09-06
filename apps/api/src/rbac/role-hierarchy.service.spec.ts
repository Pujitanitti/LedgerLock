import { ConflictException, NotFoundException } from '@nestjs/common';
import { RoleHierarchyService } from './role-hierarchy.service';
import { RolesService } from './roles.service';
import { makeMockRbacRepository } from './test-utils/mock-rbac-repository';
import { makeMockAuthzVersion } from '../authorization/authz-version/test-utils/mock-authz-version';
import type { RoleRecord } from './types/rbac-record';

function makeRole(overrides: Partial<RoleRecord> = {}): RoleRecord {
  return { id: 'role_1', tenantId: 'tenant_a', name: 'Admin', createdAt: new Date(), ...overrides };
}

describe('RoleHierarchyService.addInheritance', () => {
  it('adds a valid inheritance edge when both roles exist for the tenant and no cycle results', async () => {
    const rbacRepo = makeMockRbacRepository({
      findRoleById: jest
        .fn()
        .mockImplementation((tenantId: string, id: string) => Promise.resolve(makeRole({ id, tenantId }))),
      listInheritanceEdges: jest.fn().mockResolvedValue([]),
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleHierarchyService(rbacRepo, new RolesService(rbacRepo, authzVersion), authzVersion);

    await service.addInheritance('tenant_a', 'Admin', 'Owner');

    expect(rbacRepo.addInheritanceEdge).toHaveBeenCalledWith('tenant_a', 'Admin', 'Owner');
  });

  it('bumps the tenant authz version after a successful inheritance edge is added', async () => {
    const rbacRepo = makeMockRbacRepository({
      findRoleById: jest
        .fn()
        .mockImplementation((tenantId: string, id: string) => Promise.resolve(makeRole({ id, tenantId }))),
      listInheritanceEdges: jest.fn().mockResolvedValue([]),
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleHierarchyService(rbacRepo, new RolesService(rbacRepo, authzVersion), authzVersion);

    await service.addInheritance('tenant_a', 'Admin', 'Owner');

    expect(authzVersion.bumpTenant).toHaveBeenCalledWith('tenant_a');
  });

  it('does NOT bump the tenant authz version when a cycle is rejected', async () => {
    const rbacRepo = makeMockRbacRepository({
      findRoleById: jest.fn().mockResolvedValue(makeRole()),
      listInheritanceEdges: jest.fn().mockResolvedValue([]),
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleHierarchyService(rbacRepo, new RolesService(rbacRepo, authzVersion), authzVersion);

    await expect(service.addInheritance('tenant_a', 'role_1', 'role_1')).rejects.toBeInstanceOf(ConflictException);

    expect(authzVersion.bumpTenant).not.toHaveBeenCalled();
  });

  it('SECURITY: rejects when the parent role does not belong to the tenant', async () => {
    const rbacRepo = makeMockRbacRepository({
      findRoleById: jest.fn().mockResolvedValue(null),
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleHierarchyService(rbacRepo, new RolesService(rbacRepo, authzVersion), authzVersion);

    await expect(service.addInheritance('tenant_b', 'Admin_of_tenant_a', 'Owner')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(rbacRepo.addInheritanceEdge).not.toHaveBeenCalled();
  });

  it('rejects a self-referencing edge as a cycle', async () => {
    const rbacRepo = makeMockRbacRepository({
      findRoleById: jest.fn().mockResolvedValue(makeRole()),
      listInheritanceEdges: jest.fn().mockResolvedValue([]),
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleHierarchyService(rbacRepo, new RolesService(rbacRepo, authzVersion), authzVersion);

    await expect(service.addInheritance('tenant_a', 'role_1', 'role_1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(rbacRepo.addInheritanceEdge).not.toHaveBeenCalled();
  });

  it('rejects an edge that would close a transitive cycle (A->B->C, then C->A)', async () => {
    const rbacRepo = makeMockRbacRepository({
      findRoleById: jest
        .fn()
        .mockImplementation((tenantId: string, id: string) => Promise.resolve(makeRole({ id, tenantId }))),
      listInheritanceEdges: jest.fn().mockResolvedValue([
        { parentRoleId: 'A', childRoleId: 'B' },
        { parentRoleId: 'B', childRoleId: 'C' },
      ]),
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleHierarchyService(rbacRepo, new RolesService(rbacRepo, authzVersion), authzVersion);

    await expect(service.addInheritance('tenant_a', 'C', 'A')).rejects.toBeInstanceOf(ConflictException);
    expect(rbacRepo.addInheritanceEdge).not.toHaveBeenCalled();
  });

  it('allows extending a chain when no cycle results', async () => {
    const rbacRepo = makeMockRbacRepository({
      findRoleById: jest
        .fn()
        .mockImplementation((tenantId: string, id: string) => Promise.resolve(makeRole({ id, tenantId }))),
      listInheritanceEdges: jest.fn().mockResolvedValue([{ parentRoleId: 'A', childRoleId: 'B' }]),
    });
    const authzVersion = makeMockAuthzVersion();
    const service = new RoleHierarchyService(rbacRepo, new RolesService(rbacRepo, authzVersion), authzVersion);

    await service.addInheritance('tenant_a', 'B', 'C');

    expect(rbacRepo.addInheritanceEdge).toHaveBeenCalledWith('tenant_a', 'B', 'C');
  });
});
