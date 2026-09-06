import type { CreateUserInput, UserRecord } from '../types/user-record';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface UserRepositoryPort {
  create(input: CreateUserInput): Promise<UserRecord>;

  /** Tenant-scoped lookup — never resolves a user across tenant boundaries. */
  findByExternalId(tenantId: string, externalId: string): Promise<UserRecord | null>;

  findById(tenantId: string, id: string): Promise<UserRecord | null>;

  /**
   * Batch lookup for /v1/check/batch — one query for every distinct
   * userId in a batch request instead of one query per item (N+1).
   */
  findManyByExternalIds(tenantId: string, externalIds: readonly string[]): Promise<UserRecord[]>;

  list(tenantId: string): Promise<UserRecord[]>;

  /** Atomic increment — see TenantRepositoryPort.incrementAuthzVersion for the same rationale. */
  incrementAuthzVersion(tenantId: string, userId: string): Promise<void>;
}
