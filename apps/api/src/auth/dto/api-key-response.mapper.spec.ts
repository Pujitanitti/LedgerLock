import { toApiKeyCreatedResponse, toApiKeyMetadataResponse } from './api-key-response.mapper';
import type { ApiKeyRecord } from '../types/api-key-record';

function makeRecord(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: 'key_1',
    tenantId: 'tenant_a',
    publicId: 'abcdef0123456789',
    secretHash: 'super-secret-hash-that-must-never-leak',
    name: 'CI key',
    revokedAt: null,
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('toApiKeyMetadataResponse', () => {
  it('never includes secretHash', () => {
    const response = toApiKeyMetadataResponse(makeRecord());
    expect(response).not.toHaveProperty('secretHash');
    expect(JSON.stringify(response)).not.toContain('super-secret-hash-that-must-never-leak');
  });

  it('never includes tenantId (not the client-facing concern of this DTO)', () => {
    const response = toApiKeyMetadataResponse(makeRecord());
    expect(response).not.toHaveProperty('tenantId');
  });

  it('does not include a rawKey field at all', () => {
    const response = toApiKeyMetadataResponse(makeRecord());
    expect(response).not.toHaveProperty('rawKey');
  });

  it('serializes dates to ISO strings, and nulls stay null', () => {
    const response = toApiKeyMetadataResponse(
      makeRecord({
        revokedAt: new Date('2026-02-01T00:00:00.000Z'),
        expiresAt: null,
        lastUsedAt: new Date('2026-01-15T00:00:00.000Z'),
      }),
    );
    expect(response.revokedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(response.expiresAt).toBeNull();
    expect(response.lastUsedAt).toBe('2026-01-15T00:00:00.000Z');
  });
});

describe('toApiKeyCreatedResponse', () => {
  it('includes the raw key alongside the metadata fields', () => {
    const response = toApiKeyCreatedResponse(makeRecord(), 'll_live_abcdef0123456789_secretpart');
    expect(response.rawKey).toBe('ll_live_abcdef0123456789_secretpart');
    expect(response.id).toBe('key_1');
    expect(response.publicId).toBe('abcdef0123456789');
  });

  it('still never includes secretHash even though it embeds the raw key', () => {
    const response = toApiKeyCreatedResponse(makeRecord(), 'll_live_abcdef0123456789_secretpart');
    expect(response).not.toHaveProperty('secretHash');
  });
});
