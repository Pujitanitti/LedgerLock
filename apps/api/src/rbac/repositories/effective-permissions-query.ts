export interface RawQuery {
  sql: string;
  params: readonly string[];
}

/**
 * Builds the parameterized recursive-CTE query for
 * PrismaRbacRepository.getEffectivePermissionActions, separated into a
 * pure function specifically so its two safety-critical properties can be
 * unit-tested without a database:
 *
 *  1. Every role ID and the tenantId appear ONLY in `params`, never
 *     interpolated into `sql` — the only thing derived from
 *     `directRoleIds` and baked into the SQL text is the *count* of
 *     placeholders (an integer), never any ID's content.
 *  2. `params` has exactly `directRoleIds.length + 1` entries, in the
 *     exact order `$1..$n` (role IDs) then `$n+1` (tenantId), matching
 *     what the SQL text references. The tenantId placeholder is reused
 *     (the same `$n+1` appears three times in the SQL) — PostgreSQL
 *     supports referencing one bound parameter multiple times in a
 *     statement, so this is one value, not three.
 *
 * WHY THIS EXISTS AS RAW SQL AT ALL: Prisma's query builder has no
 * `findMany`-shaped API for a recursive CTE over a self-referential edge
 * table. Fetching the tenant's entire role graph into memory and walking
 * it with resolveEffectiveRoleIds (the pure function this SQL mirrors)
 * was considered and rejected — this runs on the authorization hot path,
 * and Phase 1/4 both call for a CTE specifically so a cache miss costs
 * one indexed query over the reachable subgraph, not the tenant's entire
 * role/permission graph. This is the only raw-SQL surface in the codebase.
 *
 * WHY $queryRawUnsafe + MANUAL PLACEHOLDERS, NOT Prisma.sql/Prisma.join:
 * those are named exports on the separately-typed `Prisma` namespace, and
 * this sandbox's pre-generation client genuinely lacks them — confirmed
 * at the JS runtime level (`Prisma.sql` is `undefined`), not just a type
 * gap. An alternative — `= ANY(${directRoleIds})` as a $queryRaw tagged
 * template, relying on the pg driver's native array-parameter binding —
 * was rejected because that binding behavior cannot be verified without a
 * live Postgres connection, which isn't reachable in this sandbox;
 * asserting confidence in unverified driver behavior isn't something this
 * project does. Manual positional placeholders rely on nothing but
 * standard, universally-documented SQL parameter binding.
 *
 * This does NOT prove the SQL is semantically correct against real
 * PostgreSQL (that requires actually running it — environment-blocked in
 * this sandbox) — it proves the query-construction logic is injection
 * -safe and internally consistent, which is the part that's actually
 * verifiable without a live database.
 */
export function buildEffectivePermissionsQuery(
  tenantId: string,
  directRoleIds: readonly string[],
): RawQuery {
  const roleIdPlaceholders = directRoleIds.map((_, index) => `$${index + 1}`).join(', ');
  const tenantIdPlaceholder = `$${directRoleIds.length + 1}`;

  const sql = `
    WITH RECURSIVE effective_roles AS (
      SELECT id
      FROM "roles"
      WHERE id IN (${roleIdPlaceholders}) AND "tenantId" = ${tenantIdPlaceholder}

      UNION

      SELECT ri."parentRoleId" AS id
      FROM "role_inheritance" ri
      INNER JOIN effective_roles er ON er.id = ri."childRoleId"
      WHERE ri."tenantId" = ${tenantIdPlaceholder}
    )
    SELECT DISTINCT p.action AS action
    FROM effective_roles er
    INNER JOIN "role_permissions" rp ON rp."roleId" = er.id
    INNER JOIN "permissions" p ON p.id = rp."permissionId"
    WHERE p."tenantId" = ${tenantIdPlaceholder}
  `;

  return { sql, params: [...directRoleIds, tenantId] };
}
