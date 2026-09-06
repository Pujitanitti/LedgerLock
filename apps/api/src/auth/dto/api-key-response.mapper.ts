import type { ApiKeyRecord } from '../types/api-key-record';
import type { ApiKeyCreatedResponseDto, ApiKeyMetadataResponseDto } from './api-key-response.dto';

/**
 * Explicit field-by-field construction rather than spreading `record` —
 * this is what actually guarantees `secretHash` can never leak into a
 * response, regardless of how the record type evolves later. A spread
 * (`{ ...record }`) would silently start leaking any new sensitive field
 * added to ApiKeyRecord in the future; this will not.
 */
export function toApiKeyMetadataResponse(record: ApiKeyRecord): ApiKeyMetadataResponseDto {
  return {
    id: record.id,
    name: record.name,
    publicId: record.publicId,
    revokedAt: record.revokedAt ? record.revokedAt.toISOString() : null,
    expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
    lastUsedAt: record.lastUsedAt ? record.lastUsedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toApiKeyCreatedResponse(record: ApiKeyRecord, rawKey: string): ApiKeyCreatedResponseDto {
  return {
    ...toApiKeyMetadataResponse(record),
    rawKey,
  };
}
