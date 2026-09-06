import type { ConditionOperator } from './condition-types';

/**
 * Strict equality with NO type coercion: comparing a string to a number
 * (e.g. "1" vs 1) is always false, never coerced. `null` equals only
 * `null`. Arrays/objects are never equal to anything via this function —
 * `in`/`contains` exist for array membership, `equals` is scalars only.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'string' || typeof a === 'number' || typeof a === 'boolean') {
    return a === b;
  }
  return false;
}

/**
 * OPERATOR SEMANTICS (authoritative — see ADR-009 for the write-up):
 *
 * MISSING ATTRIBUTE RULE (applies to every operator below): if the
 * resolved field value is `undefined` (attribute genuinely absent), the
 * condition evaluates to `false` — for EVERY operator, including
 * `not_equals` and `not_in`. This is deliberate: a naive reading might
 * expect `not_equals(undefined, "finance")` to be `true` (undefined
 * really isn't "finance"), but treating a missing attribute as
 * satisfying a negative condition is exactly the kind of gap that turns
 * an absent attribute into an accidental grant. Missing always means
 * "this condition does not match," full stop, regardless of polarity.
 *
 * NO TYPE COERCION: comparing across types (string vs number, etc.)
 * never coerces — it's simply not equal / not contained / doesn't match.
 *
 * `equals` / `not_equals`: scalar strict equality (string/number/
 * boolean/null only). Never true for arrays or objects on either side.
 *
 * `in` / `not_in`: `value` MUST be an array — if it isn't (malformed
 * policy data), the condition evaluates to `false` rather than throwing.
 * Each array element is compared to the field value via the same
 * strict-equality rule as `equals` (no coercion).
 *
 * `contains`: behavior depends on the FIELD's runtime type —
 *   - if the field is a string: case-SENSITIVE substring check (matches
 *     `.includes()`); `value` must be a string or the condition is
 *     false. `contains("Admin", "admin")` is `false` — this is the
 *     explicit, deterministic choice the spec asked to disambiguate.
 *   - if the field is an array: membership check via strict equality on
 *     elements (same as `in`, just with the array as the field rather
 *     than the configured value).
 *   - number/boolean/null fields: `contains` is not defined for them —
 *     always `false`, not an error.
 *
 * `starts_with`: string-only, case-sensitive, via `.startsWith()`. Any
 * non-string field or non-string `value` is `false`.
 */
function equals(fieldValue: unknown, value: unknown): boolean {
  return valuesEqual(fieldValue, value);
}

function notEquals(fieldValue: unknown, value: unknown): boolean {
  if (fieldValue === undefined) return false;
  return !valuesEqual(fieldValue, value);
}

function inOp(fieldValue: unknown, value: unknown): boolean {
  if (fieldValue === undefined) return false;
  if (!Array.isArray(value)) return false;
  return value.some((item) => valuesEqual(fieldValue, item));
}

function notIn(fieldValue: unknown, value: unknown): boolean {
  if (fieldValue === undefined) return false;
  if (!Array.isArray(value)) return false;
  return !value.some((item) => valuesEqual(fieldValue, item));
}

function contains(fieldValue: unknown, value: unknown): boolean {
  if (fieldValue === undefined) return false;
  if (typeof fieldValue === 'string') {
    return typeof value === 'string' && fieldValue.includes(value);
  }
  if (Array.isArray(fieldValue)) {
    return fieldValue.some((item) => valuesEqual(item, value));
  }
  return false;
}

function startsWith(fieldValue: unknown, value: unknown): boolean {
  if (fieldValue === undefined) return false;
  return typeof fieldValue === 'string' && typeof value === 'string' && fieldValue.startsWith(value);
}

/**
 * The complete, closed operator set. Every entry is a plain function —
 * no `eval`, no `new Function`, no dynamic code of any kind. Adding an
 * operator means adding one entry here; there is no other mechanism by
 * which a condition's behavior could be extended or overridden.
 */
export const OPERATORS: Readonly<Record<ConditionOperator, (fieldValue: unknown, value: unknown) => boolean>> = {
  equals,
  not_equals: notEquals,
  in: inOp,
  not_in: notIn,
  contains,
  starts_with: startsWith,
};

export function isSupportedOperator(operator: string): operator is ConditionOperator {
  return Object.prototype.hasOwnProperty.call(OPERATORS, operator);
}
