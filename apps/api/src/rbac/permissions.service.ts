import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { RBAC_REPOSITORY, type RbacRepositoryPort } from './repositories/rbac-repository.port';
import { AuthzVersionService } from '../authorization/authz-version/authz-version.service';
import type { PermissionRecord } from './types/rbac-record';

@Injectable()
export class PermissionsService {
  constructor(
    @Inject(RBAC_REPOSITORY) private readonly repository: RbacRepositoryPort,
    private readonly authzVersion: AuthzVersionService,
  ) {}

  /** Idempotent — creating the same "resource:action" twice returns the existing row. */
  async createOrGet(tenantId: string, action: string): Promise<PermissionRecord> {
    const permission = await this.repository.upsertPermission(tenantId, action);
    // Bumped unconditionally, even on an idempotent re-fetch of an
    // existing permission — permissions are managed rarely, so the extra
    // (occasionally unnecessary) invalidation is cheap next to the
    // complexity of having the repository report whether a row was
    // actually newly created vs. found.
    await this.authzVersion.bumpTenant(tenantId);
    return permission;
  }

  async getById(tenantId: string, id: string): Promise<PermissionRecord> {
    const permission = await this.repository.findPermissionById(tenantId, id);
    if (!permission) {
      throw new NotFoundException({ code: 'PERMISSION_NOT_FOUND', message: 'Permission not found.' });
    }
    return permission;
  }

  async list(tenantId: string): Promise<PermissionRecord[]> {
    return this.repository.listPermissions(tenantId);
  }
}
