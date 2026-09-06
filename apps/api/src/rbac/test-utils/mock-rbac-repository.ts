import type { RbacRepositoryPort } from '../repositories/rbac-repository.port';

export function makeMockRbacRepository(
  overrides: Partial<jest.Mocked<RbacRepositoryPort>> = {},
): jest.Mocked<RbacRepositoryPort> {
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
