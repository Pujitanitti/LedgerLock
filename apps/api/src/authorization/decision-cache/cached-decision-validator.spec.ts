import { isCachedDecision } from './cached-decision-validator';

describe('isCachedDecision', () => {
  it('accepts a valid allow decision', () => {
    expect(isCachedDecision({ allowed: true, reason: 'role_permission' })).toBe(true);
  });

  it('accepts a valid deny decision', () => {
    expect(isCachedDecision({ allowed: false, reason: 'no_matching_permission' })).toBe(true);
  });

  it.each([
    'unknown_user',
    'resource_tenant_mismatch',
    'policy_deny',
    'role_permission',
    'policy_allow',
    'no_matching_permission',
  ])('accepts every documented reason: %s', (reason) => {
    expect(isCachedDecision({ allowed: false, reason })).toBe(true);
  });

  it('rejects null', () => {
    expect(isCachedDecision(null)).toBe(false);
  });

  it('rejects a plain string', () => {
    expect(isCachedDecision('true')).toBe(false);
  });

  it('rejects a number', () => {
    expect(isCachedDecision(42)).toBe(false);
  });

  it('rejects an array', () => {
    expect(isCachedDecision([true, 'role_permission'])).toBe(false);
  });

  it('rejects a missing `allowed` field', () => {
    expect(isCachedDecision({ reason: 'role_permission' })).toBe(false);
  });

  it('rejects a missing `reason` field', () => {
    expect(isCachedDecision({ allowed: true })).toBe(false);
  });

  it('rejects `allowed` as a non-boolean', () => {
    expect(isCachedDecision({ allowed: 'true', reason: 'role_permission' })).toBe(false);
  });

  it('rejects an unrecognized reason string (defends against a future/rolled-back version mismatch)', () => {
    expect(isCachedDecision({ allowed: true, reason: 'some_new_reason_this_version_does_not_know' })).toBe(
      false,
    );
  });

  it('does not throw on a deeply malformed input', () => {
    expect(() => isCachedDecision(undefined)).not.toThrow();
    expect(() => isCachedDecision(Symbol('x'))).not.toThrow();
    expect(() => isCachedDecision(() => true)).not.toThrow();
  });
});
