import { OPERATORS, isSupportedOperator } from './operators';

const { equals, not_equals, in: inOp, not_in: notIn, contains, starts_with: startsWith } = OPERATORS;

describe('equals', () => {
  it('matches identical strings', () => expect(equals('admin', 'admin')).toBe(true));
  it('matches identical numbers', () => expect(equals(42, 42)).toBe(true));
  it('matches identical booleans', () => expect(equals(true, true)).toBe(true));
  it('matches null to null', () => expect(equals(null, null)).toBe(true));
  it('does not match different strings', () => expect(equals('admin', 'user')).toBe(false));
  it('NO COERCION: does not match a number to its string form', () => expect(equals(1, '1')).toBe(false));
  it('NO COERCION: does not match a string to its number form', () => expect(equals('1', 1)).toBe(false));
  it('does not match null to a falsy scalar', () => expect(equals(null, 0)).toBe(false));
  it('does not match null to an empty string', () => expect(equals(null, '')).toBe(false));
  it('never matches arrays', () => expect(equals(['a'], ['a'])).toBe(false));
  it('MISSING ATTRIBUTE: returns false when field is undefined', () => expect(equals(undefined, 'x')).toBe(false));
});

describe('not_equals', () => {
  it('is true for genuinely different values', () => expect(not_equals('admin', 'user')).toBe(true));
  it('is false for equal values', () => expect(not_equals('admin', 'admin')).toBe(false));
  it('MISSING ATTRIBUTE RULE: returns false (NOT true) when field is undefined, even though undefined "is not" the value', () => {
    expect(not_equals(undefined, 'finance')).toBe(false);
  });
});

describe('in', () => {
  it('is true when the field value is one of the array elements', () => {
    expect(inOp('admin', ['admin', 'user'])).toBe(true);
  });
  it('is false when the field value is not among the elements', () => {
    expect(inOp('guest', ['admin', 'user'])).toBe(false);
  });
  it('MALFORMED: is false (not a throw) when value is not an array', () => {
    expect(() => inOp('admin', 'admin')).not.toThrow();
    expect(inOp('admin', 'admin')).toBe(false);
  });
  it('MISSING ATTRIBUTE: returns false when field is undefined', () => {
    expect(inOp(undefined, ['admin'])).toBe(false);
  });
  it('uses strict no-coercion equality per element', () => {
    expect(inOp(1, ['1', '2'])).toBe(false);
  });
});

describe('not_in', () => {
  it('is true when the field value is not among the elements', () => {
    expect(notIn('guest', ['admin', 'user'])).toBe(true);
  });
  it('is false when the field value is among the elements', () => {
    expect(notIn('admin', ['admin', 'user'])).toBe(false);
  });
  it('MISSING ATTRIBUTE RULE: returns false (NOT true) when field is undefined', () => {
    expect(notIn(undefined, ['admin'])).toBe(false);
  });
  it('MALFORMED: is false when value is not an array', () => {
    expect(notIn('admin', 'not-an-array')).toBe(false);
  });
});

describe('contains — string field', () => {
  it('is true for a substring match', () => expect(contains('Administrator', 'Admin')).toBe(true));
  it('CASE SENSITIVE by explicit choice: "Admin" does not contain "admin"', () => {
    expect(contains('Admin', 'admin')).toBe(false);
  });
  it('is false when the substring is absent', () => expect(contains('Administrator', 'Root')).toBe(false));
  it('is false when value is not a string', () => expect(contains('Administrator', 5)).toBe(false));
  it('MISSING ATTRIBUTE: returns false when field is undefined', () => expect(contains(undefined, 'x')).toBe(false));
});

describe('contains — array field', () => {
  it('is true when the array includes the value (strict equality)', () => {
    expect(contains(['admin', 'user'], 'admin')).toBe(true);
  });
  it('is false when the array does not include the value', () => {
    expect(contains(['admin', 'user'], 'guest')).toBe(false);
  });
  it('NO COERCION for array element comparison', () => {
    expect(contains([1, 2, 3], '1')).toBe(false);
  });
});

describe('contains — unsupported field types', () => {
  it('is false (not an error) for a number field', () => expect(contains(42, 4)).toBe(false));
  it('is false (not an error) for a boolean field', () => expect(contains(true, true)).toBe(false));
  it('is false (not an error) for a null field', () => expect(contains(null, 'x')).toBe(false));
});

describe('starts_with', () => {
  it('is true for a matching prefix', () => expect(startsWith('invoice:delete', 'invoice:')).toBe(true));
  it('is false for a non-matching prefix', () => expect(startsWith('invoice:delete', 'project:')).toBe(false));
  it('is case sensitive', () => expect(startsWith('Invoice:delete', 'invoice:')).toBe(false));
  it('is false when the field is not a string', () => expect(startsWith(42, '4')).toBe(false));
  it('is false when value is not a string', () => expect(startsWith('invoice:delete', 42)).toBe(false));
  it('MISSING ATTRIBUTE: returns false when field is undefined', () => expect(startsWith(undefined, 'x')).toBe(false));
});

describe('isSupportedOperator', () => {
  it.each(['equals', 'not_equals', 'in', 'not_in', 'contains', 'starts_with'])(
    'accepts the documented operator: %s',
    (op) => expect(isSupportedOperator(op)).toBe(true),
  );

  it('rejects an unsupported/unknown operator', () => {
    expect(isSupportedOperator('regex_match')).toBe(false);
    expect(isSupportedOperator('greater_than')).toBe(false);
    expect(isSupportedOperator('')).toBe(false);
  });

  it('rejects dangerous-looking strings without evaluating them', () => {
    expect(isSupportedOperator('eval')).toBe(false);
    expect(isSupportedOperator('__proto__')).toBe(false);
    expect(isSupportedOperator('constructor')).toBe(false);
  });
});
