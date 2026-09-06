import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { InheritanceEdgeRecord, PermissionRecord, RoleRecord } from '../types/rbac-record';
import type { RbacRepositoryPort } from './rbac-repository.port';
import { buildEffectivePermissionsQuery } from './effective-permissions-query';

/**
 * VERIFICATION STATUS: this file calls `this.prisma.role.*`,
 * `this.prisma.permission.*`, `this.prisma.$queryRawUnsafe`, etc., all of
 * which require a real generated Prisma Client. Confirmed environment
 * -blocked at a deeper level than "just untyped": directly instantiating
 * `new PrismaClient()` in this sandbox throws immediately
 * ("@prisma/client did not initialize yet. Please run 'prisma generate'")
 * — so NONE of this file's methods can be executed here, regardless of
 * which specific Prisma API each one uses. This is unchanged by the fix
 * below; see the doc comment on getEffectivePermissionActions for what
 * the fix actually resolves (a compile-time issue, not a runtime one).
 */
@Injectable()
export class PrismaRbacRepository implements RbacRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  // --- Roles ---

  async createRole(tenantId: string, name: string): Promise<RoleRecord> {
    return this.prisma.role.create({ data: { tenantId, name } });
  }

  async findRoleById(tenantId: string, id: string): Promise<RoleRecord | null> {
    return this.prisma.role.findFirst({ where: { id, tenantId } });
  }

  async listRoles(tenantId: string): Promise<RoleRecord[]> {
    return this.prisma.role.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  }

  async deleteRole(tenantId: string, id: string): Promise<void> {
    // Scoping the delete itself by tenantId (not just a prior findFirst
    // check) means a cross-tenant delete attempt affects zero rows rather
    // than relying solely on an earlier read to have caught it.
    await this.prisma.role.deleteMany({ where: { id, tenantId } });
  }

  // --- Permissions ---

  async upsertPermission(tenantId: string, action: string): Promise<PermissionRecord> {
    return this.prisma.permission.upsert({
      where: { tenantId_action: { tenantId, action } },
      update: {},
      create: { tenantId, action },
    });
  }

  async findPermissionById(tenantId: string, id: string): Promise<PermissionRecord | null> {
    return this.prisma.permission.findFirst({ where: { id, tenantId } });
  }

  async listPermissions(tenantId: string): Promise<PermissionRecord[]> {
    return this.prisma.permission.findMany({ where: { tenantId }, orderBy: { action: 'asc' } });
  }

  // --- Role <-> Permission assignment ---

  /**
   * R-002 FIX: previously a plain `upsert` keyed only by
   * (roleId, permissionId) — correct given the service layer's
   * pre-checks, but with no independent guard if this method were ever
   * called directly. Now a guarded INSERT ... SELECT ... WHERE: the row
   * is only created if BOTH the role and the permission actually belong
   * to `tenantId`, verified in the same query as the write. If either
   * belongs to a different tenant, zero rows are inserted — silently,
   * matching the "affects zero rows rather than throwing" pattern used
   * elsewhere (e.g. TenantRepository.incrementAuthzVersion), since the
   * service layer has already turned a real mismatch into a 404 before
   * this is ever reached; this is the redundant, defense-in-depth layer.
   * `role_permissions` has a composite primary key on
   * (roleId, permissionId), so ON CONFLICT can target it directly without
   * needing a named constraint.
   */
  async assignPermissionToRole(tenantId: string, roleId: string, permissionId: string): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "role_permissions" ("roleId", "permissionId")
      SELECT r.id, p.id
      FROM "roles" r, "permissions" p
      WHERE r.id = ${roleId} AND r."tenantId" = ${tenantId}
        AND p.id = ${permissionId} AND p."tenantId" = ${tenantId}
      ON CONFLICT ("roleId", "permissionId") DO NOTHING
    `;
  }

  async removePermissionFromRole(tenantId: string, roleId: string, permissionId: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM "role_permissions" rp
      USING "roles" r, "permissions" p
      WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
        AND r.id = ${roleId} AND r."tenantId" = ${tenantId}
        AND p.id = ${permissionId} AND p."tenantId" = ${tenantId}
    `;
  }

  async listPermissionActionsForRoles(tenantId: string, roleIds: readonly string[]): Promise<string[]> {
    if (roleIds.length === 0) return [];
    const rows: { permission: { action: string } }[] = await this.prisma.rolePermission.findMany({
      where: { roleId: { in: [...roleIds] }, permission: { tenantId } },
      select: { permission: { select: { action: true } } },
    });
    return [...new Set(rows.map((r) => r.permission.action))];
  }

  // --- User <-> Role assignment ---

  /** R-002 FIX: same guarded-INSERT pattern as assignPermissionToRole above, scoped to `user_roles`. */
  async assignRoleToUser(tenantId: string, userId: string, roleId: string): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "user_roles" ("userId", "roleId")
      SELECT u.id, r.id
      FROM "users" u, "roles" r
      WHERE u.id = ${userId} AND u."tenantId" = ${tenantId}
        AND r.id = ${roleId} AND r."tenantId" = ${tenantId}
      ON CONFLICT ("userId", "roleId") DO NOTHING
    `;
  }

  async removeRoleFromUser(tenantId: string, userId: string, roleId: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM "user_roles" ur
      USING "users" u, "roles" r
      WHERE ur."userId" = u.id AND ur."roleId" = r.id
        AND u.id = ${userId} AND u."tenantId" = ${tenantId}
        AND r.id = ${roleId} AND r."tenantId" = ${tenantId}
    `;
  }

  async listRoleIdsForUser(tenantId: string, userId: string): Promise<string[]> {
    const rows: { roleId: string }[] = await this.prisma.userRole.findMany({
      where: { userId, role: { tenantId } },
      select: { roleId: true },
    });
    return rows.map((r) => r.roleId);
  }

  // --- Role hierarchy ---

  async listInheritanceEdges(tenantId: string): Promise<InheritanceEdgeRecord[]> {
    return this.prisma.roleInheritance.findMany({
      where: { tenantId },
      select: { parentRoleId: true, childRoleId: true },
    });
  }

  async addInheritanceEdge(tenantId: string, parentRoleId: string, childRoleId: string): Promise<void> {
    // Cycle-checking happens in RoleHierarchyService BEFORE this is
    // called, using the pure wouldCreateCycle algorithm against the edge
    // list from listInheritanceEdges — this method only performs the
    // (already-validated) insert. The unique constraint on
    // (tenantId, parentRoleId, childRoleId) still guards against a
    // duplicate edge under concurrent writes.
    await this.prisma.roleInheritance.upsert({
      where: { tenantId_parentRoleId_childRoleId: { tenantId, parentRoleId, childRoleId } },
      update: {},
      create: { tenantId, parentRoleId, childRoleId },
    });
  }

  /**
   * The actual authorization hot-path query. See
   * effective-permissions-query.ts (buildEffectivePermissionsQuery) for
   * the full rationale: why raw SQL/a recursive CTE is used at all rather
   * than an in-memory graph walk, why $queryRawUnsafe with manual
   * placeholders is used instead of the Prisma.sql/Prisma.join tagged
   * -template helpers (which are genuinely absent from this sandbox's
   * pre-generation client, confirmed at the runtime level), and why that
   * approach is still fully parameterized/injection-safe despite the
   * "Unsafe" in the method name. Semantics must match the pure reference
   * algorithm in role-hierarchy-graph.ts (resolveEffectiveRoleIds).
   */
  async getEffectivePermissionActions(tenantId: string, directRoleIds: readonly string[]): Promise<string[]> {
    if (directRoleIds.length === 0) return [];

    const { sql, params } = buildEffectivePermissionsQuery(tenantId, directRoleIds);
    const rows: { action: string }[] = await this.prisma.$queryRawUnsafe(sql, ...params);

    return rows.map((r) => r.action);
  }
}
