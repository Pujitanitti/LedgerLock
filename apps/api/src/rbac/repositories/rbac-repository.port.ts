import type { InheritanceEdgeRecord, PermissionRecord, RoleRecord } from '../types/rbac-record';

export const RBAC_REPOSITORY = Symbol('RBAC_REPOSITORY');

/**
 * Everything the RBAC services (roles, permissions, assignments, role
 * hierarchy) need from persistence, consolidated into one port because
 * these entities form a single bounded context with heavy cross-entity
 * queries (e.g. cycle-checking needs the full edge list; permission
 * resolution needs roles + inheritance + role-permission links together).
 * Splitting this into five separate ports would add indirection without
 * adding testability, since no service here needs only one slice of it in
 * isolation from the others. PrismaRbacRepository is the ONLY file in
 * this module touching prisma.role / prisma.permission / etc.
 */
export interface RbacRepositoryPort {
  // --- Roles ---
  createRole(tenantId: string, name: string): Promise<RoleRecord>;
  findRoleById(tenantId: string, id: string): Promise<RoleRecord | null>;
  listRoles(tenantId: string): Promise<RoleRecord[]>;
  deleteRole(tenantId: string, id: string): Promise<void>;

  // --- Permissions ---
  /** Upserts by (tenantId, action) — creating the same action twice is idempotent. */
  upsertPermission(tenantId: string, action: string): Promise<PermissionRecord>;
  findPermissionById(tenantId: string, id: string): Promise<PermissionRecord | null>;
  listPermissions(tenantId: string): Promise<PermissionRecord[]>;

  // --- Role <-> Permission assignment ---
  /**
   * R-002 FIX: takes `tenantId` and enforces it AT THE QUERY LEVEL (a
   * guarded INSERT ... SELECT ... WHERE, not a plain upsert by
   * roleId/permissionId alone) — see PrismaRbacRepository. This is
   * defense-in-depth: RoleAssignmentsService already verifies both
   * entities belong to the tenant before calling this, but the join
   * tables (RolePermission/UserRole) have no tenantId column of their
   * own, so without this the repository layer had no independent way to
   * refuse a cross-tenant assignment if ever called directly, bypassing
   * the service. See docs/risk-register.md R-002 and ADR-007.
   */
  assignPermissionToRole(tenantId: string, roleId: string, permissionId: string): Promise<void>;
  removePermissionFromRole(tenantId: string, roleId: string, permissionId: string): Promise<void>;
  listPermissionActionsForRoles(tenantId: string, roleIds: readonly string[]): Promise<string[]>;

  // --- User <-> Role assignment ---
  assignRoleToUser(tenantId: string, userId: string, roleId: string): Promise<void>;
  removeRoleFromUser(tenantId: string, userId: string, roleId: string): Promise<void>;
  listRoleIdsForUser(tenantId: string, userId: string): Promise<string[]>;

  // --- Role hierarchy ---
  listInheritanceEdges(tenantId: string): Promise<InheritanceEdgeRecord[]>;
  addInheritanceEdge(tenantId: string, parentRoleId: string, childRoleId: string): Promise<void>;

  /**
   * The authorization hot-path query: given a tenant and a set of
   * DIRECTLY assigned role IDs, returns every permission action reachable
   * through those roles AND everything they transitively inherit — using
   * a single recursive CTE, not an application-memory graph walk. See
   * PrismaRbacRepository for the actual SQL; see
   * authorization/role-hierarchy/role-hierarchy-graph.ts for the
   * tested reference semantics this query must match.
   */
  getEffectivePermissionActions(tenantId: string, directRoleIds: readonly string[]): Promise<string[]>;
}
