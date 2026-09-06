import { Inject, Injectable } from '@nestjs/common';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants/repositories/tenant-repository.port';
import { USER_REPOSITORY, type UserRepositoryPort } from '../../users/repositories/user-repository.port';

/**
 * PHASE 6 FINDING, FIXED HERE: ADR-004 (Phase 1/3) designed the Redis
 * cache-key strategy around `Tenant.authzVersion` and `User.authzVersion`,
 * and explicitly stated what should bump each — but no code anywhere in
 * Phases 3-5 ever actually called the increment. This service is the fix:
 * every RBAC/policy write path that ADR-004 named now calls one of these
 * two methods. See docs/decisions/ADR-012-phase6-decision-cache.md for
 * the full audit finding and the complete list of call sites.
 *
 * Deliberately its own tiny service/module rather than folded into
 * TenantsService/UsersService: both RbacModule and PoliciesModule need to
 * bump versions without importing each other or duplicating the
 * increment logic, and this is the shared, dependency-free place for it.
 */
@Injectable()
export class AuthzVersionService {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenantRepository: TenantRepositoryPort,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepositoryPort,
  ) {}

  /** Structural, tenant-wide authorization state changed — role/permission definitions, hierarchy, or ANY policy write. */
  async bumpTenant(tenantId: string): Promise<void> {
    await this.tenantRepository.incrementAuthzVersion(tenantId);
  }

  /** THIS user's own role assignments changed — scoped to them alone, not the whole tenant. */
  async bumpUser(tenantId: string, userId: string): Promise<void> {
    await this.userRepository.incrementAuthzVersion(tenantId, userId);
  }
}
