# ADR-009: Policy Language and Operator Semantics

## Context

Phase 5 needed a way to express attribute-based conditions (e.g. "the
requester owns this resource") without any form of code execution. The
spec explicitly required a closed, deterministic operator set with
unambiguous documented behavior for every edge case — no silent type
coercion, and an explicit answer for what happens when an attribute is
missing.

## Decision

### Structure

A condition is `{ field, operator, value }`. `field` is a whitelist
-resolved dot-path of the form `"<bag>.<key>"` where `<bag>` is exactly
one of `subject`, `resource`, `context` — see
`authorization/conditions/attribute-resolver.ts`. Nesting is capped at
exactly one level; there is no code path capable of walking into a
nested object, safe or not, which is what makes "no arbitrary path
traversal" true by construction. `__proto__`, `constructor`, and
`prototype` are explicitly rejected as keys, both at write time
(`condition-validator.ts`) and defensively at evaluation time
(`attribute-resolver.ts`).

`value` is either a literal (string/number/boolean/null/array of
strings-or-numbers) or a `{ ref: "<field>" }` pointer to another
attribute — this is what makes ownership rules like
`resource.ownerId equals { ref: "subject.id" }` possible without adding
a second condition type.

### The six operators

`equals`, `not_equals`, `in`, `not_in`, `contains`, `starts_with` — see
`authorization/conditions/operators.ts` for the authoritative,
exhaustively-documented implementation. Summarized:

- **No type coercion, ever.** `equals(1, "1")` is `false`. Comparing
  across types is simply not-equal, not a coercion.
- **`contains` is case-sensitive.** `contains("Admin", "admin")` is
  `false` — the spec explicitly asked this ambiguity to be resolved, and
  case-sensitivity was chosen as the more predictable default (a
  case-insensitive variant can be added as a distinct operator later
  without breaking anything, since operators are a closed, extensible
  lookup table).
- **MISSING ATTRIBUTE RULE, applying uniformly to all six operators:**
  if the resolved field value is `undefined`, the condition evaluates to
  `false` — including for `not_equals` and `not_in`. A naive
  implementation might return `true` for `not_equals(undefined, "x")`
  (undefined genuinely isn't "x"), but that would mean a missing
  attribute could satisfy a negative condition and produce an
  unintended grant or an unintended failure to deny. Treating "missing"
  as "does not match," full stop, regardless of operator polarity,
  closes that gap uniformly rather than requiring every future operator
  author to reason about it independently.
- **Malformed values never throw.** `in`/`not_in` with a non-array
  `value`, or `contains` against a field type it isn't defined for
  (number/boolean/null), evaluate to `false` rather than raising an
  error — see the "fail safe" rationale below.

### Two-layer defense: validate at write time, evaluate defensively at read time

`condition-validator.ts` rejects malformed conditions (wrong field
format, unsupported operator, wrong value shape) with a `400
INVALID_POLICY_CONDITION` before a policy is ever persisted.
`condition-evaluator.ts` independently NEVER throws and NEVER treats an
unexpected shape as a match — if a malformed condition somehow reached
storage anyway (a schema migration bug, manual DB edit, etc.), it fails
toward "does not match" rather than crashing the authorization decision
or, worse, silently matching. Both directions of "fail safe" matter
here: a broken condition on a DENY policy must not stop denying, and a
broken condition on an ALLOW policy must not start allowing —
"does not match" achieves both simultaneously.

## Alternatives considered

- **A general expression language / mini-DSL parser** — rejected as
  unnecessary complexity and a larger, harder-to-audit attack surface for
  a project whose explicit constraint is "no arbitrary expression
  evaluators."
- **Case-insensitive `contains` by default** — rejected as the default
  because it's a second silent decision (which Unicode case-folding
  rules?) layered on top of the first; case-sensitivity is the simpler,
  more predictable choice and doesn't preclude adding a distinct
  case-insensitive operator later.
- **Coercing `"1"` to `1` for cross-type comparisons** — rejected;
  coercion rules are a well-known source of subtle authorization bugs
  (see JavaScript's `==` history), and the closed operator set doesn't
  need it since policy authors control both sides of every condition.

## Consequences

- Policy authors must match attribute types exactly — a numeric
  `subject.planTier` compared against the string `"3"` will never match
  numeric `3`. This is a deliberate strictness trade-off in favor of
  predictability over convenience.
- Extending the operator set means adding one function to a lookup
  table, never touching the evaluator's control flow.
