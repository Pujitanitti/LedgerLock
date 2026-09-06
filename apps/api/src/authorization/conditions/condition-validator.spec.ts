import { BadRequestException } from '@nestjs/common';
import { validateConditions } from './condition-validator';

describe('validateConditions', () => {
  it('accepts an empty/undefined/null conditions input as an empty array', () => {
    expect(validateConditions(undefined)).toEqual([]);
    expect(validateConditions(null)).toEqual([]);
    expect(validateConditions([])).toEqual([]);
  });

  it('accepts a valid literal condition', () => {
    const input = [{ field: 'subject.department', operator: 'equals', value: 'finance' }];
    expect(validateConditions(input)).toEqual(input);
  });

  it('accepts a valid ref condition', () => {
    const input = [{ field: 'resource.ownerId', operator: 'equals', value: { ref: 'subject.id' } }];
    expect(validateConditions(input)).toEqual(input);
  });

  it('accepts a valid array-value condition for in/not_in', () => {
    const input = [{ field: 'subject.department', operator: 'in', value: ['finance', 'legal'] }];
    expect(validateConditions(input)).toEqual(input);
  });

  it('rejects a non-array conditions input', () => {
    expect(() => validateConditions({ field: 'x' })).toThrow(BadRequestException);
  });

  it('rejects a condition that is not an object', () => {
    expect(() => validateConditions(['not-an-object'])).toThrow(BadRequestException);
  });

  it('rejects a missing field', () => {
    expect(() => validateConditions([{ operator: 'equals', value: 'x' }])).toThrow(BadRequestException);
  });

  it('rejects a field with no bag prefix', () => {
    expect(() => validateConditions([{ field: 'department', operator: 'equals', value: 'x' }])).toThrow(
      BadRequestException,
    );
  });

  it('rejects a field with an unknown bag', () => {
    expect(() =>
      validateConditions([{ field: 'attacker.payload', operator: 'equals', value: 'x' }]),
    ).toThrow(BadRequestException);
  });

  it('rejects a field with a nested path beyond one level', () => {
    expect(() =>
      validateConditions([{ field: 'subject.nested.secret', operator: 'equals', value: 'x' }]),
    ).toThrow(BadRequestException);
  });

  it('SECURITY: rejects __proto__ as a field key', () => {
    expect(() =>
      validateConditions([{ field: 'subject.__proto__', operator: 'equals', value: 'x' }]),
    ).toThrow(BadRequestException);
  });

  it('rejects an unsupported operator', () => {
    expect(() =>
      validateConditions([{ field: 'subject.department', operator: 'regex_match', value: 'x' }]),
    ).toThrow(BadRequestException);
  });

  it('rejects a missing value', () => {
    expect(() => validateConditions([{ field: 'subject.department', operator: 'equals' }])).toThrow(
      BadRequestException,
    );
  });

  it('rejects an array value containing non-primitive elements', () => {
    expect(() =>
      validateConditions([{ field: 'subject.department', operator: 'in', value: [{ nested: true }] }]),
    ).toThrow(BadRequestException);
  });

  it('rejects a ref value whose ref is not a string', () => {
    expect(() =>
      validateConditions([{ field: 'resource.ownerId', operator: 'equals', value: { ref: 123 } }]),
    ).toThrow(BadRequestException);
  });

  it('reports which index failed for a batch with a valid condition followed by an invalid one', () => {
    const input = [
      { field: 'subject.department', operator: 'equals', value: 'finance' },
      { field: 'subject.department', operator: 'bogus_operator', value: 'x' },
    ];
    expect(() => validateConditions(input)).toThrow(/conditions\[1\]/);
  });
});
