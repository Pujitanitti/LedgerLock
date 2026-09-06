import { toPermissionResponse, toRoleResponse } from './rbac-response.dto';
import type { PermissionRecord, RoleRecord } from '../types/rbac-record';

describe('toRoleResponse', () => {
  it('maps fields and never includes tenantId', () => {
    const record: RoleRecord = {
      id: 'role_1',
      tenantId: 'tenant_a',
      name: 'Admin',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const response = toRoleResponse(record);
    expect(response).toEqual({ id: 'role_1', name: 'Admin', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(response).not.toHaveProperty('tenantId');
  });
});

describe('toPermissionResponse', () => {
  it('maps fields and never includes tenantId', () => {
    const record: PermissionRecord = {
      id: 'perm_1',
      tenantId: 'tenant_a',
      action: 'projects:read',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const response = toPermissionResponse(record);
    expect(response).toEqual({ id: 'perm_1', action: 'projects:read', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(response).not.toHaveProperty('tenantId');
  });
});
