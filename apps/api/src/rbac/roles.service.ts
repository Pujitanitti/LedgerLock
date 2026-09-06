import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { RBAC_REPOSITORY, type RbacRepositoryPort } from './repositories/rbac-repository.port';
import { AuthzVersionService } from '../authorization/authz-version/authz-version.service';
import type { RoleRecord } from './types/rbac-record';

@Injectable()
export class RolesService {
  constructor(
    @Inject(RBAC_REPOSITORY) private readonly repository: RbacRepositoryPort,
    private readonly authzVersion: AuthzVersionService,
  ) {}

  async create(tenantId: string, name: string): Promise<RoleRecord> {
    const role = await this.repository.createRole(tenantId, name);
    // A new role is tenant-wide structural state, per ADR-004 — bumping
    // here even though an empty role grants nothing yet is the
    // conservative choice (roles are created rarely; the cost of an
    // extra invalidation is negligible next to the cost of a missed one).
    await this.authzVersion.bumpTenant(tenantId);
    return role;
  }

  async getById(tenantId: string, id: string): Promise<RoleRecord> {
    const role = await this.repository.findRoleById(tenantId, id);
    if (!role) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found.' });
    }
    return role;
  }

  async list(tenantId: string): Promise<RoleRecord[]> {
    return this.repository.listRoles(tenantId);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    // Confirms existence (and tenant ownership) first so a cross-tenant
    // or nonexistent ID gets a 404, not a silent no-op success.
    await this.getById(tenantId, id);
    await this.repository.deleteRole(tenantId, id);
    await this.authzVersion.bumpTenant(tenantId);
  }
}
