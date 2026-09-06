import type { ApiKeyRecord, CreateApiKeyRecordInput } from '../types/api-key-record';

export const API_KEY_REPOSITORY = Symbol('API_KEY_REPOSITORY');

/**
 * Everything ApiKeyService needs from persistence, and nothing more. This
 * boundary is what keeps ApiKeyService (the security-critical
 * orchestration logic: parsing, hashing, status checks) fully unit
 * -testable with a plain mock object — no Prisma Client, generated or
 * otherwise, is required to test it. Only PrismaApiKeyRepository, the sole
 * implementation of this interface, touches the ORM.
 */
export interface ApiKeyRepositoryPort {
  create(input: CreateApiKeyRecordInput): Promise<ApiKeyRecord>;

  /** O(1) indexed lookup by the non-secret publicId — never scans/hashes every row. */
  findByPublicId(publicId: string): Promise<ApiKeyRecord | null>;

  /**
   * Looks up a key by ID scoped to a tenant in the SAME query — this is
   * the enforcement point for "a tenant can never touch another tenant's
   * key by guessing/supplying its ID". Returns null (not the record with
   * an ownership flag) if the key exists but belongs to a different
   * tenant, so the caller cannot distinguish "not found" from
   * "not yours" — see ApiKeyNotFoundError.
   */
  findByIdForTenant(id: string, tenantId: string): Promise<ApiKeyRecord | null>;

  listByTenant(tenantId: string): Promise<ApiKeyRecord[]>;

  revoke(id: string): Promise<void>;

  /** Best-effort usage tracking; never allowed to affect the auth decision. */
  touchLastUsed(id: string): Promise<void>;
}
