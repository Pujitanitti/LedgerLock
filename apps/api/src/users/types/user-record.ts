/**
 * A Ledger-Lock "user" is the CALLER'S end-user, identified by whatever ID
 * their own application uses (`externalId`) — never a Ledger-Lock login
 * identity. Scoped uniquely per (tenantId, externalId). Plain domain
 * interface, decoupled from Prisma's generated types — see the same
 * rationale in auth/types/api-key-record.ts.
 */
export interface UserRecord {
  id: string;
  tenantId: string;
  externalId: string;
  /** Bumped only when this user's own role assignments change — see ADR-004/ADR-012. */
  authzVersion: number;
  attributes: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CreateUserInput {
  tenantId: string;
  externalId: string;
  attributes?: Record<string, unknown>;
}
