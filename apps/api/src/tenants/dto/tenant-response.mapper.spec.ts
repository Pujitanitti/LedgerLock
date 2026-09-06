import { toTenantResponse } from './tenant-response.mapper';
import type { TenantRecord } from '../types/tenant-record';

describe('toTenantResponse', () => {
  it('maps the public fields and never includes authzVersion (internal cache-invalidation detail)', () => {
    const record: TenantRecord = {
      id: 'tenant_1',
      slug: 'acme',
      name: 'Acme Inc.',
      authzVersion: 7,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };

    const response = toTenantResponse(record);

    expect(response).toEqual({
      id: 'tenant_1',
      slug: 'acme',
      name: 'Acme Inc.',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(response).not.toHaveProperty('authzVersion');
  });
});
