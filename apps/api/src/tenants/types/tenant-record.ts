/**
 * Plain domain representation of a tenant row, decoupled from Prisma's
 * generated types for the same reason as ApiKeyRecord — see
 * auth/types/api-key-record.ts.
 */
export interface TenantRecord {
  id: string;
  slug: string;
  name: string;
  authzVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTenantInput {
  slug: string;
  name: string;
}
