# ADR-011: Policy Versioning Strategy

## Context

The spec required immutable policy versions: updating a policy must
never overwrite the historical record of what a past decision was
actually evaluated against. The Phase 1 schema's original `Policy` model
was a single row combining identity (name) and content (effect, actions,
conditions) with a mutable `version` integer — adequate for nothing more
than "policies exist," inadequate for real versioning.

## Decision

Split into two tables:

- **`Policy`** — stable identity and metadata: `id`, `tenantId`, `name`,
  `description`, `enabled`, timestamps. Mutable (name/description/enabled
  can change), but its identity (id) never does.
- **`PolicyVersion`** — immutable content: `policyId`, `version`,
  `effect`, `actions`, `resourceTypes`, `conditions`, `priority`,
  `createdAt`. Once inserted, a row is never updated or deleted by any
  code path in the application.

### "Current version" is a query, not a stored pointer

The current version for a policy is simply the `PolicyVersion` row with
the highest `version` number for that `policyId` — retrieved via
`ORDER BY version DESC LIMIT 1`, backed by the
`(tenantId, policyId, version)` index. There is no `currentVersionId`
column on `Policy` pointing back at `PolicyVersion`.

This avoids a circular foreign-key bootstrapping problem: if `Policy`
had a required pointer to its current `PolicyVersion`, and
`PolicyVersion` has a required pointer back to its `Policy`, creating
the first version requires either a nullable pointer with a
create-then-update dance, or a single transaction carefully sequencing
both inserts. A simple `MAX(version)` query needs neither — it's
already correct the moment both rows exist, requires no follow-up
update, and can't drift out of sync with reality the way a cached
pointer field could if a bug ever updated one side without the other.

### Immutability is enforced structurally, not by convention

`PolicyRepositoryPort` has no `updatePolicyVersion` or
`deletePolicyVersion` method — deliberately. "Updating" a policy
(`PoliciesService.update`) always calls `createNewVersion`, which always
computes `(current max version) + 1` and inserts a new row inside a
transaction (guarding against a concurrent update racing to claim the
same version number, backstopped by the `(policyId, version)` unique
constraint). There is no method anywhere in the codebase that a future
contributor could call to mutate history, because the method doesn't
exist — this is checked directly in `policies.service.spec.ts` ("has no
method available anywhere to mutate an existing version").

### `priority`

Exists purely as a deterministic tiebreaker for **provenance reporting**
when multiple policies of the same effect match a single check (see
ADR-010) — it never changes the allow/deny outcome, which is determined
solely by "did any deny policy match."

## Alternatives considered

- **Single mutable row with a `version` counter (the original Phase 1
  design)** — rejected; overwriting content in place is exactly what
  "immutable versioning" forbids.
- **A new `Policy` id per edit** — rejected; this breaks the concept of
  "the same policy, revised" — management APIs (enable/disable/delete,
  listing) need a stable identity to act on regardless of how many times
  its content has changed.
- **A stored `currentVersionId` pointer on `Policy`** — rejected per the
  circular-FK bootstrapping problem above; the query-based approach is
  simpler and can't drift.

## Consequences

- Every decision could in principle record exactly which policy version
  it was evaluated against (`DecisionProvenance.decidingPolicyVersion`),
  which is what "identify which version produced a decision" requires —
  this is populated today; persisting it durably alongside a decision
  (e.g. in an audit log) is Phase 6 scope, not yet built.
- Deleting a `Policy` cascades to delete all of its `PolicyVersion` rows
  (`onDelete: Cascade`) — this is the one place version history CAN be
  removed, and only as a whole-policy deletion, never a partial rewrite
  of history. This is a deliberate, coarse-grained semantic: "delete this
  policy entirely" is unambiguous; "delete one version but keep others"
  is not defined and isn't exposed.
