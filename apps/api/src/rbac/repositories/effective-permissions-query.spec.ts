import { buildEffectivePermissionsQuery } from './effective-permissions-query';

describe('buildEffectivePermissionsQuery', () => {
  it('builds one placeholder per role ID plus one for tenantId, in order', () => {
    const { sql, params } = buildEffectivePermissionsQuery('tenant_a', ['role_1', 'role_2', 'role_3']);

    expect(params).toEqual(['role_1', 'role_2', 'role_3', 'tenant_a']);
    expect(sql).toContain('IN ($1, $2, $3)');
    // The tenantId placeholder ($4) is reused for all three tenant-scoping predicates.
    expect(sql.match(/\$4/g)).toHaveLength(3);
  });

  it('handles a single direct role', () => {
    const { sql, params } = buildEffectivePermissionsQuery('tenant_a', ['role_1']);

    expect(params).toEqual(['role_1', 'tenant_a']);
    expect(sql).toContain('IN ($1)');
    expect(sql.match(/\$2/g)).toHaveLength(3);
  });

  it('SECURITY: never inlines role ID content into the SQL text, only into params', () => {
    const dangerousRoleId = "role'; DROP TABLE roles; --";
    const { sql, params } = buildEffectivePermissionsQuery('tenant_a', [dangerousRoleId]);

    expect(sql).not.toContain(dangerousRoleId);
    expect(sql).not.toContain('DROP TABLE');
    expect(params).toContain(dangerousRoleId);
  });

  it('SECURITY: never inlines tenantId content into the SQL text, only into params', () => {
    const dangerousTenantId = "tenant'; DROP TABLE tenants; --";
    const { sql, params } = buildEffectivePermissionsQuery(dangerousTenantId, ['role_1']);

    expect(sql).not.toContain(dangerousTenantId);
    expect(sql).not.toContain('DROP TABLE');
    expect(params).toContain(dangerousTenantId);
  });

  it('SECURITY: only the COUNT of role IDs affects the SQL text, never their content, across many roles', () => {
    const roleIds = Array.from({ length: 5 }, (_, i) => `role_${i}_with_weird'chars"`);
    const { sql, params } = buildEffectivePermissionsQuery('tenant_a', roleIds);

    for (const id of roleIds) {
      expect(sql).not.toContain(id);
    }
    expect(sql).toContain('IN ($1, $2, $3, $4, $5)');
    expect(params).toEqual([...roleIds, 'tenant_a']);
  });

  it('references the correct table and column names from the schema', () => {
    const { sql } = buildEffectivePermissionsQuery('tenant_a', ['role_1']);

    expect(sql).toContain('"roles"');
    expect(sql).toContain('"role_inheritance"');
    expect(sql).toContain('"role_permissions"');
    expect(sql).toContain('"permissions"');
    expect(sql).toContain('"parentRoleId"');
    expect(sql).toContain('"childRoleId"');
    expect(sql).toContain('"tenantId"');
  });

  it('is a recursive CTE that unions the base case with the parent-walk', () => {
    const { sql } = buildEffectivePermissionsQuery('tenant_a', ['role_1']);

    expect(sql).toMatch(/WITH RECURSIVE effective_roles AS/);
    expect(sql).toMatch(/UNION/);
    expect(sql).toMatch(/SELECT DISTINCT p\.action/);
  });

  it('produces the exact same params length as directRoleIds.length + 1, regardless of input size', () => {
    for (const size of [1, 2, 10, 50]) {
      const roleIds = Array.from({ length: size }, (_, i) => `role_${i}`);
      const { params } = buildEffectivePermissionsQuery('tenant_a', roleIds);
      expect(params).toHaveLength(size + 1);
    }
  });
});
