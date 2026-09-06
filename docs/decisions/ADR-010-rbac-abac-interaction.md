# ADR-010: RBAC + ABAC Interaction and Conflict Resolution

## Context

Phase 5 added ABAC alongside the existing Phase 4 RBAC engine. The two
must combine into a single, deterministic decision — the spec explicitly
forbade leaving this implicit.

## Decision

The full pipeline, per authorization check:

```
Authentication (Phase 3) -> Tenant Context -> resolve user
  -> resource-tenant consistency check (immediate deny on mismatch)
  -> RBAC evaluation (effective permissions via role hierarchy)
  -> ABAC evaluation (matching policy versions' conditions)
  -> combineRbacAndAbac (pure function, decision-combination.ts)
  -> final Decision
```

RBAC and ABAC are computed independently of each other and combined by
exactly one pure function, `combineRbacAndAbac`. The complete table:

| RBAC allowed | ABAC decision | Result | Reason                |
|--------------|----------------|--------|------------------------|
| false        | deny           | DENY   | policy_deny            |
| true         | deny           | DENY   | policy_deny            |
| true         | allow          | ALLOW  | role_permission        |
| true         | no_opinion     | ALLOW  | role_permission        |
| false        | allow          | ALLOW  | policy_allow           |
| false        | no_opinion     | DENY   | no_matching_permission |

### DENY > ALLOW is unconditional

An ABAC deny wins regardless of what RBAC says — checked first, before
anything else, in `combineRbacAndAbac`. This directly implements the
spec's required invariant and is exhaustively tested in
`decision-combination.spec.ts` and `policy-evaluation.service.spec.ts`
(deny wins regardless of how many allow policies also matched, and
regardless of the order candidates come back from the database).

### ABAC augments RBAC — it does not only restrict it

Row 5 of the table (`RBAC=false, ABAC=allow -> ALLOW`) is the important,
easy-to-miss case: a user can be granted access via an ABAC policy even
when no role grants them the underlying permission at all. This is
deliberate and is exactly what makes resource-ownership rules useful —
"the owner of an invoice may update it" should work even for a user who
holds no `invoices:update`-granting role. Replacing RBAC with ABAC-only
gatekeeping, or making ABAC a pure restriction layer on top of RBAC,
would both have made this ownership pattern impossible to express
without also handing out the blanket role permission it's meant to
avoid.

### Reason attribution when both contribute

When RBAC alone already allows AND an ABAC policy also matched with
`allow`, the reported reason is `role_permission`, not `policy_allow`.
RBAC is treated as the more foundational grant for the single public
reason string; full detail (every matched policy, and which one is
"the" deciding one) is available in `DecisionProvenance.matchedPolicies`
for internal/future-audit use, never in the public `/v1/check` response.

## Alternatives considered

- **ABAC as a pure restriction layer (can only narrow RBAC, never
  widen it)** — rejected; this would make ownership-based ALLOW rules
  impossible without an accompanying broad RBAC grant, defeating a core
  ABAC use case.
- **Evaluating ABAC first, RBAC second** — the actual order the code
  evaluates things in (RBAC's effective-actions query, then ABAC's
  candidate fetch) doesn't matter for the final decision, since
  `combineRbacAndAbac` only looks at both final results together — but
  RBAC's resource-tenant-mismatch short-circuit happens before either is
  computed, since an inconsistent resource claim is invalid input
  regardless of what any policy might say about it.
- **Letting policy `priority` override deny-dominance** — rejected;
  `priority` exists purely as a deterministic tiebreaker for
  provenance reporting when multiple same-effect policies match (see
  ADR-011 / the PolicyVersion schema comment), and never changes the
  allow/deny outcome itself.

## Consequences

- A tenant that never creates any ABAC policies gets exactly the Phase 4
  RBAC-only behavior — proven directly by the Phase 4 regression suite,
  which mocks `PolicyEvaluationService` to always return `no_opinion`.
- Every meaningful combination cell has a direct unit test
  (`decision-combination.spec.ts`), not just the two "obvious" ones.
