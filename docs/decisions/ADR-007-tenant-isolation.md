# ADR-007: Tenant Isolation Strategy

## Context

Every tenant-scoped row must be unreachable from any other tenant's
requests. PostgreSQL Row-Level Security (RLS) was evaluated as the
spec requires.

## Decision

**Application-level tenant isolation is the primary mechanism** for Phase 1
through the initial production-ready release:

- Every repository/service method that touches tenant-scoped data takes
  `tenantId: string` as a mandatory (non-optional) typed parameter — there
  is no code path that queries `User`, `Role`, `Policy`, `AuditLog`, etc.
  without it.
- `tenantId` for the current request is derived exclusively from the
  authenticated API key's associated tenant — never accepted from the
  request body — closing the "trust a client-supplied tenant ID" hole.
- Integration tests explicitly attempt cross-tenant reads (Tenant A's key
  requesting Tenant B's data) and assert an empty/denied result for every
  tenant-scoped entity (section 4 of the spec).

RLS is deferred as an **optional defense-in-depth layer**, not implemented
in this phase.

## Why RLS is deferred rather than adopted immediately

RLS depends on a session-scoped variable (`SET LOCAL app.tenant_id = ...`)
being set correctly on every connection before any query runs. This
interacts badly with:

- **Connection pooling** — PgBouncer in transaction-pooling mode (the mode
  you want for a high-QPS authorization service) can hand the same
  physical connection to different logical transactions between commands,
  so a session variable set for one tenant can leak into the next request
  if not re-set with total discipline on every acquisition.
- **Prisma** — has no first-class API for setting session variables per
  request; every query would need to be wrapped in `$transaction` with a
  raw `SET LOCAL` issued first, which is real per-request complexity and a
  second place (besides the application check) where a missing call
  silently reintroduces the exact bug RLS is meant to prevent.

Given that Ledger-Lock's Postgres is accessed **only** by Ledger-Lock's own
repository layer (no other service or ad hoc query tool touches this
database), application-level enforcement is not "trusting application code
instead of the database" in the usual risky sense — it *is* the single,
narrow, testable boundary between all data access and the database.

## Alternatives considered

- **RLS as the sole mechanism** — rejected for the pooling/Prisma reasons
  above; a subtle RLS misconfiguration is harder to catch than a missing
  `tenantId` parameter, which TypeScript's type system and code review can
  catch before the code ever runs.
- **RLS + application checks together from day one** — the ideal end
  state, but adds meaningful implementation complexity before the
  authorization engine itself (the actual subject of this project) exists.
  Deferred, not abandoned.

## Consequences

- Isolation correctness depends on repository-layer discipline, enforced by
  (a) the TypeScript signature requiring `tenantId`, and (b) integration
  tests that would fail loudly if a query ever omitted the tenant
  predicate.
- A future phase can add RLS as a second, independent layer once the
  session-variable plumbing can be built and tested without slowing down
  the phases that matter more right now (RBAC, ABAC, caching).
- This is a residual risk worth naming explicitly in the final security
  audit (Phase 17) rather than glossing over.
