import { evaluateAllConditions, evaluateCondition } from './condition-evaluator';
import type { Condition, EvaluationAttributes } from './condition-types';

function makeAttrs(overrides: Partial<EvaluationAttributes> = {}): EvaluationAttributes {
  return {
    subject: { id: 'user_1', roles: ['role_member'], department: 'finance' },
    resource: { type: 'invoice', id: 'inv_1', ownerId: 'user_1' },
    context: { ip: '1.2.3.4' },
    ...overrides,
  };
}

describe('evaluateCondition — literal values', () => {
  it('matches a literal equals condition', () => {
    const condition: Condition = { field: 'subject.department', operator: 'equals', value: 'finance' };
    expect(evaluateCondition(condition, makeAttrs())).toBe(true);
  });

  it('does not match when the literal value differs', () => {
    const condition: Condition = { field: 'subject.department', operator: 'equals', value: 'engineering' };
    expect(evaluateCondition(condition, makeAttrs())).toBe(false);
  });

  it('evaluates an in condition against a literal array', () => {
    const condition: Condition = { field: 'subject.department', operator: 'in', value: ['finance', 'legal'] };
    expect(evaluateCondition(condition, makeAttrs())).toBe(true);
  });
});

describe('evaluateCondition — ref values (ownership rules)', () => {
  it('matches an ownership condition: resource.ownerId equals subject.id', () => {
    const condition: Condition = { field: 'resource.ownerId', operator: 'equals', value: { ref: 'subject.id' } };
    expect(evaluateCondition(condition, makeAttrs())).toBe(true);
  });

  it('does not match ownership when the resource belongs to someone else', () => {
    const attrs = makeAttrs({ resource: { type: 'invoice', id: 'inv_1', ownerId: 'user_2' } });
    const condition: Condition = { field: 'resource.ownerId', operator: 'equals', value: { ref: 'subject.id' } };
    expect(evaluateCondition(condition, attrs)).toBe(false);
  });

  it('does not match (false, not a throw) when the ref target cannot be resolved', () => {
    const condition: Condition = {
      field: 'resource.ownerId',
      operator: 'equals',
      value: { ref: 'subject.nonexistent' },
    };
    expect(() => evaluateCondition(condition, makeAttrs())).not.toThrow();
    expect(evaluateCondition(condition, makeAttrs())).toBe(false);
  });

  it('supports not_equals with a ref for an "anyone but the owner" rule', () => {
    const condition: Condition = {
      field: 'resource.ownerId',
      operator: 'not_equals',
      value: { ref: 'subject.id' },
    };
    const attrs = makeAttrs({ resource: { type: 'invoice', id: 'inv_1', ownerId: 'user_2' } });
    expect(evaluateCondition(condition, attrs)).toBe(true);
  });
});

describe('evaluateCondition — malformed input never throws and never accidentally matches', () => {
  it('returns false for an unsupported operator', () => {
    const condition = { field: 'subject.department', operator: 'regex_match', value: '.*' } as unknown as Condition;
    expect(() => evaluateCondition(condition, makeAttrs())).not.toThrow();
    expect(evaluateCondition(condition, makeAttrs())).toBe(false);
  });

  it('returns false for a condition referencing a missing attribute', () => {
    const condition: Condition = { field: 'subject.plan', operator: 'equals', value: 'enterprise' };
    expect(evaluateCondition(condition, makeAttrs())).toBe(false);
  });

  it('returns false for a condition with an unresolvable field bag', () => {
    const condition = { field: 'evil.payload', operator: 'equals', value: 'x' } as Condition;
    expect(evaluateCondition(condition, makeAttrs())).toBe(false);
  });
});

describe('evaluateAllConditions — AND semantics', () => {
  it('returns true when every condition matches', () => {
    const conditions: Condition[] = [
      { field: 'subject.department', operator: 'equals', value: 'finance' },
      { field: 'resource.ownerId', operator: 'equals', value: { ref: 'subject.id' } },
    ];
    expect(evaluateAllConditions(conditions, makeAttrs())).toBe(true);
  });

  it('returns false when any single condition fails to match', () => {
    const conditions: Condition[] = [
      { field: 'subject.department', operator: 'equals', value: 'finance' },
      { field: 'subject.department', operator: 'equals', value: 'engineering' }, // contradicts
    ];
    expect(evaluateAllConditions(conditions, makeAttrs())).toBe(false);
  });

  it('returns true (vacuously) for an empty condition list — an unconditional policy version', () => {
    expect(evaluateAllConditions([], makeAttrs())).toBe(true);
  });
});
