import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { RBAC_REPOSITORY, type RbacRepositoryPort } from './repositories/rbac-repository.port';
import { RolesService } from './roles.service';
import { AuthzVersionService } from '../authorization/authz-version/authz-version.service';
import { wouldCreateCycle } from '../authorization/role-hierarchy/role-hierarchy-graph';

@Injectable()
export class RoleHierarchyService {
  constructor(
    @Inject(RBAC_REPOSITORY) private readonly repository: RbacRepositoryPort,
    private readonly rolesService: RolesService,
    private readonly authzVersion: AuthzVersionService,
  ) {}

  /**
   * `childRoleId` will inherit every permission `parentRoleId` grants.
   * Both roles must belong to the authenticated tenant (checked via
   * RolesService.getById, which throws NotFoundException otherwise), and
   * the edge must not close a cycle in the tenant's existing role graph.
   */
  async addInheritance(tenantId: string, parentRoleId: string, childRoleId: string): Promise<void> {
    await this.rolesService.getById(tenantId, parentRoleId);
    await this.rolesService.getById(tenantId, childRoleId);

    const edges = await this.repository.listInheritanceEdges(tenantId);
    if (wouldCreateCycle(edges, parentRoleId, childRoleId)) {
      throw new ConflictException({
        code: 'ROLE_HIERARCHY_CYCLE',
        message: 'This inheritance edge would create a cycle in the role hierarchy.',
      });
    }

    await this.repository.addInheritanceEdge(tenantId, parentRoleId, childRoleId);
    // An inheritance edge changes the effective-permissions CTE result
    // for every user holding the child role (or anything inheriting from
    // it) — tenant-wide, per ADR-004/ADR-012.
    await this.authzVersion.bumpTenant(tenantId);
  }
}
