const WILDCARD = '*';

/**
 * A policy version's `actions` array entries are either an exact
 * "resource:action" string or the literal wildcard "*" (matches any
 * action). Deliberately no glob/regex support — a closed, simple,
 * fully-deterministic pattern language rather than a general expression
 * engine, consistent with the rest of the policy language.
 */
export function actionMatches(pattern: string, action: string): boolean {
  return pattern === WILDCARD || pattern === action;
}

/**
 * A policy version's `resourceTypes` array entries follow the same rule.
 * `requestedType` is `undefined` when the check request included no
 * `resource` at all — in that case ONLY a "*" entry can match, since
 * there is no concrete resource type to compare against a specific
 * pattern. This means a policy scoped to a specific resource type (e.g.
 * ["invoice"]) simply does not apply to a resourceless check, which is
 * the intuitively correct behavior: such a policy has nothing to say
 * about a request that isn't about a resource of that type.
 */
export function resourceTypeMatches(pattern: string, requestedType: string | undefined): boolean {
  if (pattern === WILDCARD) return true;
  if (requestedType === undefined) return false;
  return pattern === requestedType;
}

export function actionsMatchAny(patterns: readonly string[], action: string): boolean {
  return patterns.some((pattern) => actionMatches(pattern, action));
}

export function resourceTypesMatchAny(patterns: readonly string[], requestedType: string | undefined): boolean {
  return patterns.some((pattern) => resourceTypeMatches(pattern, requestedType));
}
