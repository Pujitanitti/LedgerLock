import type { EvaluationAttributes } from './condition-types';

/**
 * Keys that must never be resolved, regardless of bag, to prevent
 * prototype-pollution-style access via a policy's `field` string (e.g. a
 * condition authored as `field: "subject.__proto__"`). Defense in depth:
 * `Object.prototype.hasOwnProperty` below already excludes inherited
 * properties, but this list makes the intent explicit and independent of
 * that mechanism.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Resolves a condition's `field` (e.g. "subject.department",
 * "resource.ownerId") against the three attribute bags. Returns
 * `undefined` for anything not cleanly resolvable — unknown bag, missing
 * key, forbidden key, or a deeper-than-one-level path — rather than
 * throwing. A missing/unresolvable attribute is a normal, expected input
 * to the operator layer (see operators.ts), not an error condition.
 *
 * Deliberately restricted to exactly one level of nesting
 * ("<bag>.<key>", never "<bag>.<key>.<nested>") — this is what makes
 * "not arbitrary path traversal" true by construction rather than by
 * convention: there is no code path here that could walk into a nested
 * object at all, safe or not.
 */
export function resolveAttribute(field: string, attributes: EvaluationAttributes): unknown {
  const dotIndex = field.indexOf('.');
  if (dotIndex === -1) return undefined;

  const bag = field.slice(0, dotIndex);
  const key = field.slice(dotIndex + 1);

  if (key.includes('.')) return undefined; // no deeper nesting
  if (FORBIDDEN_KEYS.has(key)) return undefined;

  switch (bag) {
    case 'subject':
      return readOwnProperty(attributes.subject, key);
    case 'resource':
      return readOwnProperty(attributes.resource, key);
    case 'context':
      return readOwnProperty(attributes.context, key);
    default:
      return undefined;
  }
}

function readOwnProperty(bag: Record<string, unknown> | undefined, key: string): unknown {
  if (!bag) return undefined;
  if (!Object.prototype.hasOwnProperty.call(bag, key)) return undefined;
  return bag[key];
}
