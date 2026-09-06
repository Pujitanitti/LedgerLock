/**
 * Plain domain representation of an API key row. Deliberately NOT imported
 * from `@prisma/client`'s generated namespace — this lets the crypto,
 * policy, and service layers be fully unit-tested without depending on
 * Prisma Client generation having run. The one real Prisma-backed
 * repository (PrismaApiKeyRepository) returns objects that structurally
 * satisfy this interface.
 */
export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  publicId: string;
  secretHash: string;
  name: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface CreateApiKeyRecordInput {
  tenantId: string;
  publicId: string;
  secretHash: string;
  name: string;
  expiresAt: Date | null;
}
