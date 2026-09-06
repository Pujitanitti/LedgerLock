# Ledger-Lock Architecture

This document explains Ledger-Lock as one coherent system. Individual
design decisions, their alternatives, and their trade-offs live in
[`docs/decisions/`](decisions) — this document explains how those
decisions fit together, and does not re-derive reasoning already
captured in an ADR.

## 1. Project Goals

Ledger-Lock exists to answer one question, safely, quickly, and
explainably, on behalf of other applications:

> Can subject X perform action Y on resource Z, under context C, within
> tenant T?

"Safely" means deny-by-default and fail-closed under every dependency
failure. "Quickly" means a version-aware cache that never trades
correctness for speed. "Explainably" means every decision can be traced
to the specific role, permission, or policy that produced it, and every
decision — cached or not — is durably audited.

## 2. Why a Modular Monolith

Ledger-Lock is a single NestJS application, not a set of microservices.
The authorization decision path (`POST /v1/check`) is latency-sensitive
and touches RBAC resolution, ABAC evaluation, and the decision cache in
one logical operation — splitting these across service boundaries would
add network hops to the one code path where latency matters most, for no
corresponding benefit (these components don't have independent scaling
or deployment requirements from each other). Internal module boundaries
(auth, tenants, users, rbac, policies, authorization, audit) still
enforce the same separation of concerns a microservice split would, via
NestJS modules and TypeScript interfaces — see §15.

## 3. Authentication Boundary

Every tenant-scoped request is authenticated by an API key
(`ll_live_<publicId>_<secret>`), verified via `ApiKeyGuard`. The
authenticated tenant is attached to the request by the guard alone —
**no controller, DTO, or service ever accepts a tenant ID from the
client**. This is the single invariant most of the rest of the system's
tenant-isolation guarantees are built on top of. See
[ADR-006](decisions/ADR-006-api-key-hashing.md) for API-key hashing and
pepper rotation, and [ADR-007](decisions/ADR-007-tenant-isolation.md) for
the tenant-isolation strategy this enables.

## 4. Multi-Tenancy

Tenant isolation is enforced primarily at the application layer: every
repository method that touches tenant-scoped data takes `tenantId` as a
required parameter, and integration tests assert that a cross-tenant ID
resolves to "not found," never to another tenant's data. As a documented
defense-in-depth exception, the RBAC join tables (`RolePermission`,
`UserRole`) — which have no `tenantId` column of their own — are guarded
at the query level with a `INSERT ... SELECT ... WHERE` pattern that
verifies both sides of the join belong to the same tenant, so a
cross-tenant write affects zero rows even if a service-layer check were
ever bypassed.

## 5. RBAC

`User —(UserRole)→ Role —(RolePermission)→ Permission`, with `Role`
supporting inheritance via `RoleInheritance` edges (a role's permissions
propagate down through the roles that inherit from it). Two independent
implementations of "resolve effective permissions" exist by design:

- A **pure, DB-free graph algorithm** (`role-hierarchy-graph.ts`) used to
  reject cycles at write time and as the tested reference for what
  "effective" means.
- A **PostgreSQL recursive CTE** (`PrismaRbacRepository.
  getEffectivePermissionActions`) used on the actual authorization hot
  path, so a permission check never loads a tenant's entire role graph
  into application memory.

Both must agree on semantics; the pure algorithm's tests are the
executable specification the SQL is written against.

## 6. Role Hierarchy / Cycle Prevention

A new inheritance edge is rejected if it would create a cycle, checked by
walking the tenant's existing edge set (small, fetched once) with the
same pure algorithm from §5 — cycle-checking is a rare, write-time
operation, so an in-memory graph walk there does not conflict with §5's
"never load the whole graph on the hot path" principle, which applies
specifically to the frequent, latency-sensitive read path.

## 7. ABAC

Policies are declarative JSON, evaluated by a closed, six-operator
condition language — never executable code (no `eval`, no `Function`
constructor, no dynamic code generation; verified directly by source
grep, not merely asserted). See
[ADR-009](decisions/ADR-009-policy-language-semantics.md) for the full
operator semantics, including the deliberate "a missing attribute never
satisfies a negative condition" rule that closes an entire class of
accidental-grant bugs. Policy content is immutable and versioned — a
`Policy`/`PolicyVersion` split where "updating" a policy always inserts a
new version rather than overwriting one; see
[ADR-011](decisions/ADR-011-policy-versioning.md) for why this required a
schema redesign partway through the project and how "current version" is
resolved without a circular foreign key.

## 8. Decision Combination

RBAC and ABAC are computed independently and combined by exactly one
pure function (`combineRbacAndAbac`), never scattered across the
codebase as ad hoc checks. See
[ADR-010](decisions/ADR-010-rbac-abac-interaction.md) for the full
six-cell table and the reasoning for why ABAC can grant access RBAC alone
would deny (not just restrict it).

## 9. Authorization Decision Engine

`DecisionEngineService` is the single orchestration point for
`POST /v1/check` and `/v1/check/batch`: resolve the user → check for a
resource-tenant mismatch → consult the cache → on a miss, resolve RBAC
and ABAC independently → combine → cache the result → enqueue an audit
event → respond. The authoritative evaluation logic
(`evaluateAuthoritatively`) has no cache or audit concerns baked into it,
kept separable so it can be reasoned about and tested independently of
either.

## 10. Decision Caching

See [ADR-004](decisions/ADR-004-policy-versioning.md) (the original
tenant/user version-counter design) and
[ADR-012](decisions/ADR-012-phase6-decision-cache.md) (the Phase 6
extension: the ABAC-safe attribute-hash key dimension, what is and isn't
cached, and the documented batch-staleness trade-off). The one invariant
worth restating here because it governs everything else: **Redis is an
optimization, never a source of truth** — every failure mode resolves to
a cache miss, never an accidental allow.

## 11. Authorization Versioning

`Tenant.authzVersion` and `User.authzVersion` are atomic counters
(`UPDATE ... SET x = x + 1`, never read-modify-write in application
code). Every RBAC/ABAC write path bumps the appropriate counter — tenant
-wide structural changes (roles, permissions, role-permission
assignments, inheritance edges, and every policy write) bump the tenant
counter; a single user's role assignment change bumps only that user's
counter. A version bump makes every previously cached decision at the
old version number permanently unreachable (never explicitly deleted —
just never looked up again), which is what makes invalidation correct
without needing to enumerate and delete affected cache keys.

## 12. Audit Outbox

Authorization decisions are audited via the transactional outbox
pattern, reusing (and extending) the `AuditOutbox`/`AuditLog` tables
introduced in the original schema design rather than inventing a
separate mechanism. Every decision — cache hit or miss — enqueues an
event synchronously (a single indexed insert) without ever blocking or
failing the authorization response.

## 13. Audit Processing

`AuditOutboxProcessorService.processBatch()` claims unprocessed,
not-yet-dead-lettered rows whose backoff window has elapsed, writes each
to `AuditLog` via an idempotent upsert (keyed by `sourceOutboxId`, so a
crash-and-retry never produces a duplicate row), and marks the source row
processed — in that order, specifically so a crash between the two steps
is safely recoverable. Failures get exponential backoff and eventual
dead-lettering after a bounded number of attempts. **Nothing currently
schedules this method on an interval** — see the risk register, R-008 —
the processing logic is complete and tested; wiring a scheduler is an
open decision requiring a dependency choice not yet made.

## 14. Database Responsibilities

PostgreSQL (via Prisma) is the single source of truth for all
authorization-relevant state — tenants, users, roles, permissions, role
hierarchy, policies and their versions, API keys, and the audit trail.
Redis holds only derived, disposable cache entries. This split means a
total Redis data loss degrades performance, never correctness.

## 15. Ports & Adapters

Every module that touches Prisma does so through exactly one repository
class implementing a narrow port interface (e.g. `RbacRepositoryPort` →
`PrismaRbacRepository`), injected via a DI token. Services depend on the
port, never the concrete Prisma client — this is what makes services
like `DecisionEngineService` and `PoliciesService` fully unit-testable
with a plain mock object, with no database required. The one documented
exception is `TenantProvisioningService`, which uses a raw Prisma
transaction directly because it must atomically create a `Tenant` and
its first `ApiKey` across what would otherwise be two separate
repository calls — a narrow, intentional exception, not an
inconsistency (see the file's own doc comment for the full reasoning).

## 16. Error / Failure Boundaries

A single global exception filter (`AllExceptionsFilter`) is the only
place that converts any thrown error into a public API response — no
controller or service is trusted to redact sensitive detail itself.
Typed domain errors (e.g. `RevokedApiKeyError`) carry a stable machine
-readable `code`; anything else collapses to a generic, detail-free 500.
This is also where the project's "never leak stack traces / SQL errors /
Redis internals" guarantee is actually enforced, not just documented.

## 17. Testing Strategy

The large majority of Ledger-Lock's logic — crypto, RBAC graph
algorithms, ABAC condition evaluation, cache-key construction, the
RBAC+ABAC combination table, audit retry/backoff logic — is pure or
port-mocked and runs with zero infrastructure dependency. A smaller set
of files (one Prisma repository per bounded context) necessarily touches
the ORM directly and has never executed against a real database in this
development environment (see the README's Environment Limitations
section and the risk register's R-004/R-005/R-007/R-009). The
distinction is deliberate and load-bearing: the ports-and-adapters
boundary in §15 exists specifically so that the *authorization logic*
can be fully verified independent of whether the *persistence layer* has
been.

## 18. Known Limitations

See [`docs/risk-register.md`](risk-register.md) for the authoritative,
maintained list. The headline items as of this writing: `POST
/v1/tenants` remains unauthenticated by necessity (rate-limited only);
ABAC's `subject.roles` reflects direct role assignments only, not
inherited ones; and the audit outbox processor has no scheduler wired to
it yet. None of these are hidden — each has an ADR or risk-register entry
explaining why it's open and what would close it.
