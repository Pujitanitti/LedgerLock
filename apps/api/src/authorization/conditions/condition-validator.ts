import { BadRequestException } from '@nestjs/common';
import { isSupportedOperator } from './operators';
import type { Condition, ConditionValue } from './condition-types';

const VALID_BAGS = new Set(['subject', 'resource', 'context']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validates a policy version's conditions array BEFORE it is ever
 * persisted. This is the complementary half of condition-evaluator.ts's
 * defensive runtime handling: that layer makes sure a malformed condition
 * can never turn into ALLOW even if one somehow reached storage; this
 * layer's job is to make sure one never reaches storage in the first
 * place. Throws BadRequestException (never silently drops or coerces
 * anything) on the first structural problem found.
 */
export function validateConditions(input: unknown): Condition[] {
  if (input === undefined || input === null) return [];

  if (!Array.isArray(input)) {
    throw invalid('conditions must be an array.');
  }

  return input.map((raw, index) => validateOneCondition(raw, index));
}

function validateOneCondition(raw: unknown, index: number): Condition {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw invalid(`conditions[${index}] must be an object.`);
  }

  const { field, operator, value } = raw as Record<string, unknown>;

  if (typeof field !== 'string' || field.length === 0) {
    throw invalid(`conditions[${index}].field must be a non-empty string.`);
  }
  validateFieldShape(field, index);

  if (typeof operator !== 'string' || !isSupportedOperator(operator)) {
    throw invalid(
      `conditions[${index}].operator must be one of: equals, not_equals, in, not_in, contains, starts_with.`,
    );
  }

  validateValueShape(value, index);

  return { field, operator, value: value as ConditionValue };
}

function validateFieldShape(field: string, index: number): void {
  const dotIndex = field.indexOf('.');
  if (dotIndex === -1) {
    throw invalid(`conditions[${index}].field must be in "<bag>.<key>" format, e.g. "subject.department".`);
  }
  const bag = field.slice(0, dotIndex);
  const key = field.slice(dotIndex + 1);

  if (!VALID_BAGS.has(bag)) {
    throw invalid(`conditions[${index}].field must start with one of: subject, resource, context.`);
  }
  if (key.includes('.')) {
    throw invalid(`conditions[${index}].field does not support nested paths beyond "<bag>.<key>".`);
  }
  if (FORBIDDEN_KEYS.has(key) || key.length === 0) {
    throw invalid(`conditions[${index}].field has an invalid key.`);
  }
}

function validateValueShape(value: unknown, index: number): void {
  if (value === undefined) {
    throw invalid(`conditions[${index}].value is required.`);
  }
  const isLiteral =
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number'));
  const isRef =
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).ref === 'string';

  if (!isLiteral && !isRef) {
    throw invalid(
      `conditions[${index}].value must be a string, number, boolean, null, an array of strings/numbers, ` +
        `or a { ref: "<field>" } pointer.`,
    );
  }
}

function invalid(message: string): BadRequestException {
  return new BadRequestException({ code: 'INVALID_POLICY_CONDITION', message });
}
