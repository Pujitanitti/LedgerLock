import { resolveAttribute } from './attribute-resolver';
import { isSupportedOperator, OPERATORS } from './operators';
import type { Condition, ConditionValue, EvaluationAttributes } from './condition-types';

/**
 * Evaluates a single condition against the given attributes. NEVER
 * throws — an unsupported operator or any other malformed shape
 * evaluates to `false` (does not match), which is the safe direction:
 * a condition on a DENY policy that fails to evaluate correctly must not
 * silently stop denying, and a condition on an ALLOW policy that fails to
 * evaluate correctly must not silently start allowing. Returning `false`
 * achieves both simultaneously — see condition-validator.ts for the
 * complementary write-time check that keeps malformed conditions from
 * ever being persisted in the first place.
 */
export function evaluateCondition(condition: Condition, attributes: EvaluationAttributes): boolean {
  if (!isSupportedOperator(condition.operator)) {
    return false;
  }

  const fieldValue = resolveAttribute(condition.field, attributes);
  const comparisonValue = resolveConditionValue(condition.value, attributes);
  const operatorFn = OPERATORS[condition.operator];

  return operatorFn(fieldValue, comparisonValue);
}

/** ALL conditions in a policy version must match — AND semantics, no partial credit. */
export function evaluateAllConditions(conditions: readonly Condition[], attributes: EvaluationAttributes): boolean {
  return conditions.every((condition) => evaluateCondition(condition, attributes));
}

/**
 * A condition's `value` is either a literal or a `{ ref: "<field>" }`
 * pointer to another attribute — e.g. comparing "resource.ownerId" to
 * whatever "subject.id" currently resolves to, for an ownership rule.
 * A `{ ref }` whose target itself can't be resolved returns `undefined`,
 * which every operator above already treats as "does not match".
 */
function resolveConditionValue(value: ConditionValue, attributes: EvaluationAttributes): unknown {
  if (isRef(value)) {
    return resolveAttribute(value.ref, attributes);
  }
  return value;
}

function isRef(value: ConditionValue): value is { ref: string } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'ref' in value;
}
