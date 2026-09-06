import { toPolicyResponse, toPolicyVersionResponse } from './policy-response.dto';
import type { PolicyRecord, PolicyVersionRecord } from '../types/policy-record';

describe('toPolicyResponse', () => {
  it('maps fields and never includes tenantId', () => {
    const record: PolicyRecord = {
      id: 'policy_1',
      tenantId: 'tenant_a',
      name: 'my-policy',
      description: 'desc',
      enabled: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };

    const response = toPolicyResponse(record);

    expect(response).toEqual({
      id: 'policy_1',
      name: 'my-policy',
      description: 'desc',
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(response).not.toHaveProperty('tenantId');
  });
});

describe('toPolicyVersionResponse', () => {
  it('maps fields and never includes tenantId', () => {
    const record: PolicyVersionRecord = {
      id: 'pv_1',
      policyId: 'policy_1',
      tenantId: 'tenant_a',
      version: 2,
      effect: 'deny',
      actions: ['invoices:delete'],
      resourceTypes: ['invoice'],
      conditions: [],
      priority: 5,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    const response = toPolicyVersionResponse(record);

    expect(response).toEqual({
      id: 'pv_1',
      policyId: 'policy_1',
      version: 2,
      effect: 'deny',
      actions: ['invoices:delete'],
      resourceTypes: ['invoice'],
      conditions: [],
      priority: 5,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(response).not.toHaveProperty('tenantId');
  });
});
