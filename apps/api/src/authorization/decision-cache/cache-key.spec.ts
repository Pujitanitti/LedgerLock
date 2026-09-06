import { buildDecisionCacheKey, hashAttributes, type CacheKeyInput } from './cache-key';

function baseInput(overrides: Partial<CacheKeyInput> = {}): CacheKeyInput {
  return {
    tenantId: 'tenant_a',
    tenantAuthzVersion: 1,
    userId: 'ext_alice',
    userAuthzVersion: 1,
    action: 'invoices:update',
    resourceType: 'invoice',
    resourceId: 'inv_1',
    ...overrides,
  };
}

describe('buildDecisionCacheKey - isolation dimensions', () => {
  it('produces different keys for different tenants', () => {
    const a = buildDecisionCacheKey(baseInput({ tenantId: 'tenant_a' }));
    const b = buildDecisionCacheKey(baseInput({ tenantId: 'tenant_b' }));
    expect(a).not.toBe(b);
  });

  it('produces different keys for different users within the same tenant', () => {
    const a = buildDecisionCacheKey(baseInput({ userId: 'ext_alice' }));
    const b = buildDecisionCacheKey(baseInput({ userId: 'ext_bob' }));
    expect(a).not.toBe(b);
  });

  it('produces different keys for different actions', () => {
    const a = buildDecisionCacheKey(baseInput({ action: 'invoices:update' }));
    const b = buildDecisionCacheKey(baseInput({ action: 'invoices:delete' }));
    expect(a).not.toBe(b);
  });

  it('produces different keys for different resource types', () => {
    const a = buildDecisionCacheKey(baseInput({ resourceType: 'invoice' }));
    const b = buildDecisionCacheKey(baseInput({ resourceType: 'project' }));
    expect(a).not.toBe(b);
  });

  it('produces different keys for different resource ids', () => {
    const a = buildDecisionCacheKey(baseInput({ resourceId: 'inv_1' }));
    const b = buildDecisionCacheKey(baseInput({ resourceId: 'inv_2' }));
    expect(a).not.toBe(b);
  });

  it('SECURITY: an identical resourceId with different resource attributes produces different keys', () => {
    const a = buildDecisionCacheKey(
      baseInput({ resource: { type: 'invoice', id: 'inv_1', ownerId: 'ext_alice' } }),
    );
    const b = buildDecisionCacheKey(
      baseInput({ resource: { type: 'invoice', id: 'inv_1', ownerId: 'ext_bob' } }),
    );
    expect(a).not.toBe(b);
  });

  it('SECURITY: different context payloads (e.g. IP) produce different keys', () => {
    const a = buildDecisionCacheKey(baseInput({ context: { ip: '1.2.3.4' } }));
    const b = buildDecisionCacheKey(baseInput({ context: { ip: '9.9.9.9' } }));
    expect(a).not.toBe(b);
  });
});

describe('buildDecisionCacheKey - version-awareness', () => {
  it('produces different keys for different tenant authz versions', () => {
    const a = buildDecisionCacheKey(baseInput({ tenantAuthzVersion: 1 }));
    const b = buildDecisionCacheKey(baseInput({ tenantAuthzVersion: 2 }));
    expect(a).not.toBe(b);
  });

  it('produces different keys for different user authz versions', () => {
    const a = buildDecisionCacheKey(baseInput({ userAuthzVersion: 1 }));
    const b = buildDecisionCacheKey(baseInput({ userAuthzVersion: 2 }));
    expect(a).not.toBe(b);
  });

  it('is otherwise identical for the same versions (a stale key becomes unreachable, not deleted)', () => {
    const a = buildDecisionCacheKey(baseInput());
    const b = buildDecisionCacheKey(baseInput());
    expect(a).toBe(b);
  });
});

describe('buildDecisionCacheKey - resourceless checks', () => {
  it('uses a stable sentinel, never an empty string, for a resourceless check', () => {
    const key = buildDecisionCacheKey(baseInput({ resourceType: undefined, resourceId: undefined }));
    expect(key).toContain('_none');
    expect(key).not.toMatch(/::/);
  });

  it('is stable/deterministic for the same resourceless input', () => {
    const a = buildDecisionCacheKey(baseInput({ resourceType: undefined, resourceId: undefined }));
    const b = buildDecisionCacheKey(baseInput({ resourceType: undefined, resourceId: undefined }));
    expect(a).toBe(b);
  });
});

describe('hashAttributes', () => {
  it('is deterministic for the same input', () => {
    const resource = { type: 'invoice', id: 'inv_1', ownerId: 'ext_alice' };
    expect(hashAttributes(resource, undefined)).toBe(hashAttributes(resource, undefined));
  });

  it('is order-independent - differently-ordered keys hash identically', () => {
    const a = { type: 'invoice', id: 'inv_1', ownerId: 'ext_alice' };
    const b = { ownerId: 'ext_alice', id: 'inv_1', type: 'invoice' };
    expect(hashAttributes(a, undefined)).toBe(hashAttributes(b, undefined));
  });

  it('is order-independent for nested objects too', () => {
    const a = { resource: { type: 'invoice', nested: { x: 1, y: 2 } } };
    const b = { resource: { nested: { y: 2, x: 1 }, type: 'invoice' } };
    expect(hashAttributes(a, undefined)).toBe(hashAttributes(b, undefined));
  });

  it('produces a stable hash for both resource and context being absent', () => {
    expect(hashAttributes(undefined, undefined)).toBe(hashAttributes(undefined, undefined));
    expect(hashAttributes(undefined, undefined)).toHaveLength(16);
  });

  it('distinguishes resource-only from context-only payloads of identical shape', () => {
    const shared = { x: 1 };
    const resourceOnly = hashAttributes(shared, undefined);
    const contextOnly = hashAttributes(undefined, shared);
    expect(resourceOnly).not.toBe(contextOnly);
  });

  it('produces a 16-character hex digest', () => {
    expect(hashAttributes({ a: 1 }, { b: 2 })).toMatch(/^[0-9a-f]{16}$/);
  });

  it('handles arrays, treating element ORDER as significant (arrays are sequences, not sets)', () => {
    const a = hashAttributes({ roles: ['admin', 'viewer'] }, undefined);
    const b = hashAttributes({ roles: ['viewer', 'admin'] }, undefined);
    expect(a).not.toBe(b);
  });

  it('produces the same hash for identically-ordered arrays regardless of how they were constructed', () => {
    const a = hashAttributes({ roles: ['admin', 'viewer'] }, undefined);
    const b = hashAttributes({ roles: ['admin', 'viewer'] }, undefined);
    expect(a).toBe(b);
  });

  it('sorts object keys nested inside array elements', () => {
    const a = hashAttributes({ items: [{ x: 1, y: 2 }] }, undefined);
    const b = hashAttributes({ items: [{ y: 2, x: 1 }] }, undefined);
    expect(a).toBe(b);
  });

  it('handles boolean values, distinguishing true from false', () => {
    const a = hashAttributes({ active: true }, undefined);
    const b = hashAttributes({ active: false }, undefined);
    expect(a).not.toBe(b);
  });

  it('handles numeric values, distinguishing different numbers', () => {
    const a = hashAttributes({ amount: 100 }, undefined);
    const b = hashAttributes({ amount: 200 }, undefined);
    expect(a).not.toBe(b);
  });

  it('does NOT coerce a number and its string form to the same hash', () => {
    const a = hashAttributes({ amount: 100 }, undefined);
    const b = hashAttributes({ amount: '100' }, undefined);
    expect(a).not.toBe(b);
  });

  it('handles explicit null values, distinguishing them from the field being absent entirely', () => {
    const withNull = hashAttributes({ ownerId: null }, undefined);
    const withoutField = hashAttributes({}, undefined);
    expect(withNull).not.toBe(withoutField);
  });

  it('handles an empty object resource distinctly from no resource at all', () => {
    const empty = hashAttributes({}, undefined);
    const absent = hashAttributes(undefined, undefined);
    expect(empty).not.toBe(absent);
  });

  it('handles an empty array value', () => {
    expect(() => hashAttributes({ roles: [] }, undefined)).not.toThrow();
    const a = hashAttributes({ roles: [] }, undefined);
    const b = hashAttributes({ roles: ['x'] }, undefined);
    expect(a).not.toBe(b);
  });

  it('handles a completely empty context object the same way every time', () => {
    expect(hashAttributes(undefined, {})).toBe(hashAttributes(undefined, {}));
  });
});
