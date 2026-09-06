import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { RBAC_REPOSITORY, type RbacRepositoryPort } from './repositories/rbac-repository.port';
import { RolesService } from './roles.service';
import { PermissionsService } from './permissions.service';
import { AuthzVersionService } from '../authorization/authz-version/authz-version.service';
import { USER_REPOSITORY, type UserRepositoryPort } from '../users/repositories/user-repository.port';

/**
 * Every method here re-verifies tenant ownership of EVERY entity involved
 * (via RolesService.getById / PermissionsService.getById / a direct user
 * lookup) before writing an assignment — never trusting that an ID
 * supplied by the caller belongs to their tenant just because their
 * request was authenticated. This is what makes
 * "Tenant A cannot modify Tenant B role assignments" true even if a
 * Tenant A caller supplies a role or user ID that happens to belong to
 * Tenant B: the lookup for that ID, scoped to Tenant A, simply returns
 * not-found. As of the R-002 fix, `tenantId` is also passed through to
 * the repository's join-table write methods, which now independently
 * guard against a cross-tenant write at the query level — the checks
 * here and the guard there are intentionally redundant.
 *
 * Cache-invalidation scope (Phase 6): role<->permission assignment
 * changes the EFFECTIVE PERMISSIONS of every user holding that role
 * (directly or via inheritance) — tenant-wide blast radius, so it bumps
 * the tenant version. user<->role assignment only changes what THAT user
 * holds — bumps only their own version. See ADR-012.
 */
@Injectable()
export class RoleAssignmentsService {
  constructor(
    @Inject(RBAC_REPOSITORY) private readonly repository: RbacRepositoryPort,
    private readonly rolesService: RolesService,
    private readonly permissionsService: PermissionsService,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepositoryPort,
    private readonly authzVersion: AuthzVersionService,
  ) {}

  async assignPermissionToRole(tenantId: string, roleId: string, permissionId: string): Promise<void> {
    await this.rolesService.getById(tenantId, roleId);
    await this.permissionsService.getById(tenantId, permissionId);
    await this.repository.assignPermissionToRole(tenantId, roleId, permissionId);
    await this.authzVersion.bumpTenant(tenantId);
  }

  async removePermissionFromRole(tenantId: string, roleId: string, permissionId: string): Promise<void> {
    await this.rolesService.getById(tenantId, roleId);
    await this.permissionsService.getById(tenantId, permissionId);
    await this.repository.removePermissionFromRole(tenantId, roleId, permissionId);
    await this.authzVersion.bumpTenant(tenantId);
  }

  async assignRoleToUser(tenantId: string, userId: string, roleId: string): Promise<void> {
    await this.assertUserBelongsToTenant(tenantId, userId);
    await this.rolesService.getById(tenantId, roleId);
    await this.repository.assignRoleToUser(tenantId, userId, roleId);
    await this.authzVersion.bumpUser(tenantId, userId);
  }

  async removeRoleFromUser(tenantId: string, userId: string, roleId: string): Promise<void> {
    await this.assertUserBelongsToTenant(tenantId, userId);
    await this.rolesService.getById(tenantId, roleId);
    await this.repository.removeRoleFromUser(tenantId, userId, roleId);
    await this.authzVersion.bumpUser(tenantId, userId);
  }

  private async assertUserBelongsToTenant(tenantId: string, userId: string): Promise<void> {
    const user = await this.userRepository.findById(tenantId, userId);
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
  }
}
