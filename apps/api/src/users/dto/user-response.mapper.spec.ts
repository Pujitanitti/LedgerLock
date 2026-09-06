import { toUserResponse } from './user-response.mapper';
import type { UserRecord } from '../types/user-record';

describe('toUserResponse', () => {
  it('maps fields and never includes tenantId', () => {
    const record: UserRecord = {
      id: 'user_1',
      tenantId: 'tenant_a',
      externalId: 'ext_123',
      authzVersion: 3,
      attributes: { department: 'finance' },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    const response = toUserResponse(record);

    expect(response).toEqual({
      id: 'user_1',
      externalId: 'ext_123',
      attributes: { department: 'finance' },
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(response).not.toHaveProperty('tenantId');
    expect(response).not.toHaveProperty('authzVersion');
  });
});
