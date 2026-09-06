import type { CreateTenantInput, TenantRecord } from '../types/tenant-record';

export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY');

export interface TenantRepositoryPort {
  create(input: CreateTenantInput): Promise<TenantRecord>;
  findBySlug(slug: string): Promise<TenantRecord | null>;
  findById(id: string): Promise<TenantRecord | null>;

  /**
   * Lighter than findById for the authorization hot path, which needs
   * only this one column on every check — avoids fetching the full
   * Tenant row (slug, name, timestamps) when only the version is needed.
   */
  getAuthzVersion(tenantId: string): Promise<number | null>;

  /**
   * Atomic `authzVersion = authzVersion + 1` (never read-modify-write in
   * application code, to avoid lost updates under concurrent writes —
   * see ADR-004). Silently affects zero rows for a nonexistent tenantId
   * rather than throwing, since callers have always already verified the
   * tenant exists by the time they call this.
   */
  incrementAuthzVersion(tenantId: string): Promise<void>;
}
