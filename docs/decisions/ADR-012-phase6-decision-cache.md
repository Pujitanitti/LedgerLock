# ADR-012: Phase 6 — Decision Cache, Version Invalidation, and Audit Pipeline

## Status

**Proposed / Provisional.** A complete Phase 6 specification was not supplied — only the teaser "Redis decision caching, policy-version cache invalidation, audit decision pipeline, authorization performance optimization." Everything below is inferred from Phases 1–5's established architecture plus that teaser, and is a set of implementation decisions for review, not a previously-approved requirement.

## Audit finding that shaped this design

Before writing any cache code, the existing implementation was inspected as instructed. This turned up a real, blocking gap: **ADR-004 (Phase 1/3) designed the cache-key strategy around `Tenant.authzVersion`/`User.authzVersion`, but no code in Phases 3–5 ever incremented either counter.** Every RBAC and Policy write path (`RolesService`, `PermissionsService`, `RoleAssignmentsService`, `RoleHierarchyService`, `PoliciesService`) left both fields permanently at their default value of 1. Building the Redis cache on top of ADR-004's key design as-is would have meant it never invalidated on any RBAC or policy change — a correctness bug, not a hypothetical. This is fixed as part of Phase 6 (`AuthzVersionService`), not treated as separate scope, because safe caching is impossible without it.

## Decision 1 — Cache key (extends ADR-004, does not replace it)

```
authz:{tenantId}:{tenantAuthzVersion}:{userId}:{userAuthzVersion}:{action}:{resourceType}:{resourceId}:{attributesHash}
```

Every ADR-004 dimension is unchanged. **New in Phase 6:** `attributesHash` — SHA-256 (truncated to 64 bits) of the sorted-key JSON of `{resource, context}` as supplied on the request. ADR-004 predates ABAC; a decision can now depend on arbitrary caller-supplied attribute *values* (`resource.ownerId`, `context.ip`) that Ledger-Lock doesn't own or store, not just a resource's stable type/id. Without the hash, two requests for the same `resourceId` but different attribute payloads (e.g. an invoice changing owners) could incorrectly share a cache entry. See `authorization/decision-cache/cache-key.ts` for the full reasoning, including the alternative considered and rejected (an "only hash attributes when a policy actually reads them" optimization — rejected as speculative complexity for this phase).

A resourceless check uses a fixed sentinel (`_none`) for resourceType/resourceId, never an empty string.

## Decision 2 — What's cached

`{allowed, reason}` only. **Provenance (matched policy IDs/versions) is never cached.** It can go stale independently of the boolean it produced — e.g. a matched policy could later be deleted while the cached ALLOW it once justified is still correctly version-gated as valid. Provenance is always recomputed fresh on a cache miss; a cache-hit decision's audit record honestly reports `servedFromCache: true` with no matched-policy detail, rather than fabricating provenance that was never recomputed.

## Decision 3 — Invalidation scope (fixing the audit finding above)

| Event | Scope bumped | Reasoning |
|---|---|---|
| Role create/delete | Tenant | Structural, tenant-wide state per ADR-004 |
| Permission create | Tenant | Same |
| Role<->Permission assign/unassign | Tenant | Changes effective permissions for every user holding that role (directly or via inheritance) |
| Role inheritance edge added | Tenant | Changes the CTE result for every user holding the child role or anything inheriting from it |
| User<->Role assign/unassign | **User only** | Scoped to exactly the affected user — the one case that is NOT tenant-wide |
| Policy create/update(new version)/enable-disable/delete | Tenant | **Every** policy write, unconditionally — see reasoning below |

**No third "policy version" dimension was added to the cache key.** A policy change bumps the same `Tenant.authzVersion` counter, invalidating the tenant's entire cache on any policy write. This was a deliberate choice, not the "lazy conservative default" the phase spec warned against: unlike a role assignment (naturally scoped to one user), a policy is itself a tenant-wide artifact — ABAC evaluates every enabled policy against every authenticated user's every check, so any policy change could in principle affect any user's any decision. Tenant-wide invalidation is the *correct* scope here, not an approximation of it.

## Decision 4 — Audit pipeline: durable-but-asynchronous

Reused the existing Phase 1 `AuditOutbox`/`AuditLog` tables rather than inventing a new mechanism, extending both (see schema changes in the Phase 6 report). Every decision — cache hit or miss — is enqueued via `AuditService.recordDecision`, which does a single indexed insert into `AuditOutbox` and **never blocks or fails the authorization response**: if the enqueue itself fails, the error is logged and swallowed, since a missing audit trail for one decision is a lesser failure than making tenant access depend on audit-infrastructure health.

A separate `AuditOutboxProcessorService.processBatch()` drains the outbox into `AuditLog`, with:
- **Idempotency**: `AuditLog.sourceOutboxId` (unique) is upserted on, not inserted — reprocessing the same outbox row after a crash between "wrote AuditLog" and "marked outbox processed" is a safe no-op.
- **Ordering for crash-safety**: AuditLog is written *before* the outbox row is marked processed, specifically so a crash in between leaves the row re-claimable rather than silently lost.
- **Backoff**: deterministic exponential backoff (2s -> 4s -> 8s... capped at 5 minutes), stored as `nextAttemptAt` on the row itself — no scheduler dependency needed for retry timing.
- **Dead-lettering**: after 5 attempts, `deadLetteredAt` is set and the row is permanently excluded from future claims, but never deleted (operator visibility).

**Explicitly out of scope, flagged for review:** nothing in this codebase actually *calls* `processBatch()` on an interval. Wiring a scheduler means picking a dependency (`@nestjs/schedule` or similar), which wasn't added without explicit sign-off, per "no dependencies without necessity." The processing logic itself is fully built and unit-tested independent of how it gets triggered.

## Decision 5 — Fail-safe behavior

`RedisDecisionCache` treats every failure mode identically: connection error, timeout, non-JSON garbage, and well-formed-but-wrong-shaped JSON all resolve to `null` (a miss), never a thrown error and never an accidental allow. `isCachedDecision` validates against the closed set of known `DecisionReason` values at runtime — a reason string a rolled-back or future app version wouldn't recognize is rejected, not coerced.

## Decision 6 — Version-bump atomicity (known residual gap)

`AuthzVersionService.bumpTenant`/`bumpUser` are called as a **separate,
sequential** operation after the triggering mutation (e.g.
`RolesService.create` awaits `repository.createRole(...)`, then
separately awaits `authzVersion.bumpTenant(...)`) — not wrapped together
in a single cross-repository database transaction. This is a genuine,
documented residual gap: if the mutation commits successfully but the
version bump then fails, the mutation's effect persists in the database
even though the overall service call rejects and the caller sees an
error.

What IS guaranteed: the caller is never told the operation succeeded
when the version bump didn't happen — the error propagates rather than
being swallowed (verified directly in `roles.service.spec.ts`'s
"ROLLBACK BEHAVIOR" test). This is the safer half of the gap: it
prevents the worse failure mode, where a client believes a decision
would be invalidated based on a nominally-successful response but it
actually wasn't.

**Not fixed here** because closing it properly requires the RBAC/Policy
repositories and the Tenant/User repositories to share a single Prisma
transaction across module/port boundaries — a real architectural change
(the ports are currently designed independently, each backed by its own
slice of `PrismaService`), not a small fix, and this failure mode (the
bump call itself failing after a successful write, as opposed to the
whole request failing) is a narrow edge case rather than the common
path. Tracked as a known limitation rather than silently accepted.

## Decision 7 — Batch authorization version-staleness window (accepted, bounded trade-off)

`evaluateBatch` reads `tenantAuthzVersion` once, and each resolved user's
`authzVersion` once (via a single batched user lookup), then reuses both
for every item's cache key for the remainder of that one batch call —
this is what lets the batch avoid re-querying the database per item (see
Decision on batching efficiency, Phase 4/5).

**The exposure this creates, precisely:** if a tenant-wide or
user-specific authorization-affecting mutation commits WHILE a batch call
is still executing, items processed *later in that same batch call*
continue to build cache keys using the version numbers captured at the
start — not the new, already-current version. If a cache entry already
exists under that now-superseded key (from an earlier item in the same
batch, or from an entirely different request before the batch started), a
later item in the batch can receive that entry via a genuine cache HIT,
even though the authoritative state has already changed.

**This is a real, bounded window, not a hypothetical one — and it is
explicitly accepted as a trade-off, not an oversight:**

- Every request that BEGINS after the mutation commits reads the new,
  current version and can never construct the old (now-orphaned) cache
  key — so the exposure never affects any request outside the one batch
  call that was already in flight when the mutation happened.
- The window's upper bound is exactly the wall-clock duration of one
  `evaluateBatch` call, which is itself bounded by `MAX_BATCH_SIZE` (50
  items). It is not unbounded, and it is not silent — this section exists
  specifically so it is not silent.
- Re-fetching `tenantAuthzVersion`/each user's `authzVersion` per item
  would close this window, but would reintroduce exactly the N+1
  database access pattern batching exists to avoid, on the highest
  -throughput endpoint in the system. That trade-off is rejected here —
  the bounded, documented exposure is judged preferable to reintroducing
  N+1 queries, given the window's small and strictly bounded blast
  radius (one in-flight batch, never any request that starts after the
  mutation).
- **This is NOT claimed to be zero, and the batch is NOT claimed to be
  perfectly linearizable with concurrent mutations.** A batch in flight
  during a permission revocation can, in the specific circumstance
  described above, serve a stale ALLOW to a later item in that same
  batch for the remainder of that call.

**Not fixed in code** for the reason stated (would defeat the batching
optimization this design exists for) — tracked here explicitly so a
future reader evaluates it as a conscious trade-off rather than
rediscovering it as a surprise.

## Alternatives considered

- **Caching full `Decision` including provenance** — rejected per Decision 2.
- **A third cache-key dimension specifically for policy version** — rejected per Decision 3; subsumed into the tenant version bump.
- **Synchronous, request-blocking audit** — rejected; would couple authorization latency to audit/Postgres health, which Phase 1's own `AuditOutbox` design already existed specifically to avoid.

## Consequences

- Cache hit rate is lower for attribute-heavy ABAC checks than a hypothetical design that only hashes attributes when a policy actually reads them — an accepted, documented trade-off (see cache-key.ts).
- Any policy write invalidates a tenant's entire cache, which is correct but means tenants that edit policies frequently will see proportionally more cache misses — acceptable since policy edits are expected to be much rarer than authorization checks.
- The audit processor's scheduling remains a genuine gap requiring a follow-up decision (see risk register R-008).
