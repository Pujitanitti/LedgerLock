/**
 * The six operators required by Phase 5. Deliberately a closed, explicit
 * set evaluated by a lookup table (operators.ts) — never a generic
 * expression interpreter, never eval, never dynamically generated code.
 */
export type ConditionOperator = 'equals' | 'not_equals' | 'in' | 'not_in' | 'contains' | 'starts_with';

/**
 * `field` is a whitelist-resolved dot-path of the form "<bag>.<key>",
 * where bag is exactly one of "subject", "resource", "context" — see
 * attribute-resolver.ts. `value` is either a literal to compare against,
 * or a `{ ref }` pointer to another attribute (e.g. comparing
 * "resource.ownerId" against "subject.id" for an ownership rule).
 */
export interface Condition {
  field: string;
  operator: ConditionOperator;
  value: ConditionValue;
}

export type ConditionValue = string | number | boolean | null | string[] | number[] | { ref: string };

/** The three attribute bags a condition's `field` may reference. */
export interface EvaluationAttributes {
  subject: SubjectAttributes;
  resource?: ResourceAttributes;
  context?: ContextAttributes;
}

/**
 * Deliberately narrow: `id` and `roles` are the only structurally
 * guaranteed fields (roles are the caller's DIRECTLY assigned role IDs —
 * see the scoping note in decision-engine/types.ts and risk-register.md
 * R-006 for why inheritance-expanded roles aren't included here yet).
 * Everything else comes from User.attributes and is intentionally
 * untyped beyond "some JSON value" — ABAC conditions are the only
 * consumer, via the whitelist resolver, never raw property access.
 */
export interface SubjectAttributes {
  id: string;
  roles: string[];
  [key: string]: unknown;
}

/** Reuses the same shape as the RBAC decision engine's ResourceContext. */
export interface ResourceAttributes {
  type: string;
  id: string;
  tenantId?: string;
  [key: string]: unknown;
}

/** Caller-supplied request context — IP, time, or other request metadata. */
export interface ContextAttributes {
  [key: string]: unknown;
}
