# ADR-004: Dual-Version (Tenant + User) Cache Invalidation

## Context

Authorization decisions are cached in Redis for performance. A cached
decision must never remain valid after the state that produced it changes.
A single global `policyVersion` per tenant was the initial design, but it
means any structural change (e.g. renaming a role) invalidates every cached
decision for every user in that tenant simultaneously — a thundering herd
against PostgreSQL immediately after any admin action, worst on the tenants
where caching matters most.

## Decision

Use two independent counters:

- `Tenant.authzVersion` — incremented on structural changes: role/permission
  definitions, role inheritance edges, policy create/update/delete.
- `User.authzVersion` — incremented only when that specific user's role
  assignments change.

The Redis cache key includes both:
`authz:{tenantId}:{userId}:{action}:{resourceType}:{resourceId}:{tenantAuthzVersion}:{userAuthzVersion}`

## Alternatives considered

- **Single tenant-wide version** — simplest, but causes unnecessary mass
  invalidation as described above.
- **Explicit key deletion on every write** — requires enumerating every
  affected cache key (every user × every resource previously checked),
  which isn't tractable without maintaining a reverse index, and risks
  missing a key if the delete logic has a bug (a missed delete = a stale
  ALLOW served indefinitely until TTL).
- **Per-decision version (versioning every single cached tuple)** — no
  meaningful benefit over the two-level scheme and adds bookkeeping.

## Consequences

- A structural change still invalidates a whole tenant's cache, which is
  correct (it truly can change everyone's access) but is now the exception
  rather routine per-user role change is now scoped correctly.
- Old cache keys are never explicitly deleted — they simply become
  unreachable once the version changes, and expire via TTL. This trades a
  small amount of unreachable Redis memory (bounded by TTL) for eliminating
  an entire class of invalidation bugs.
- Both counters are incremented via `UPDATE ... SET x = x + 1` (atomic in
  PostgreSQL), not read-modify-write in application code, to avoid lost
  updates under concurrent writes.
