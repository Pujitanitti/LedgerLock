import { resolveAttribute } from './attribute-resolver';
import type { EvaluationAttributes } from './condition-types';

function makeAttrs(overrides: Partial<EvaluationAttributes> = {}): EvaluationAttributes {
  return {
    subject: { id: 'user_1', roles: ['role_admin'], department: 'finance' },
    resource: { type: 'invoice', id: 'inv_1', ownerId: 'user_1' },
    context: { ip: '1.2.3.4' },
    ...overrides,
  };
}

describe('resolveAttribute', () => {
  it('resolves a top-level subject attribute', () => {
    expect(resolveAttribute('subject.id', makeAttrs())).toBe('user_1');
  });

  it('resolves a custom subject attribute', () => {
    expect(resolveAttribute('subject.department', makeAttrs())).toBe('finance');
  });

  it('resolves a resource attribute', () => {
    expect(resolveAttribute('resource.ownerId', makeAttrs())).toBe('user_1');
  });

  it('resolves a context attribute', () => {
    expect(resolveAttribute('context.ip', makeAttrs())).toBe('1.2.3.4');
  });

  it('returns undefined for a missing key within a valid bag', () => {
    expect(resolveAttribute('subject.nonexistent', makeAttrs())).toBeUndefined();
  });

  it('returns undefined when resource is absent entirely', () => {
    expect(resolveAttribute('resource.ownerId', makeAttrs({ resource: undefined }))).toBeUndefined();
  });

  it('returns undefined when context is absent entirely', () => {
    expect(resolveAttribute('context.ip', makeAttrs({ context: undefined }))).toBeUndefined();
  });

  it('returns undefined for an unknown bag', () => {
    expect(resolveAttribute('attacker.id', makeAttrs())).toBeUndefined();
  });

  it('returns undefined for a field with no dot at all', () => {
    expect(resolveAttribute('subject', makeAttrs())).toBeUndefined();
  });

  it('SECURITY: returns undefined for a path deeper than one level', () => {
    const attrs = makeAttrs({ subject: { id: 'u1', roles: [], nested: { secret: 'x' } } });
    expect(resolveAttribute('subject.nested.secret', attrs)).toBeUndefined();
  });

  it('SECURITY: refuses to resolve __proto__', () => {
    expect(resolveAttribute('subject.__proto__', makeAttrs())).toBeUndefined();
  });

  it('SECURITY: refuses to resolve constructor', () => {
    expect(resolveAttribute('subject.constructor', makeAttrs())).toBeUndefined();
  });

  it('SECURITY: refuses to resolve prototype', () => {
    expect(resolveAttribute('subject.prototype', makeAttrs())).toBeUndefined();
  });

  it('SECURITY: does not resolve inherited properties, only own properties', () => {
    // toString is inherited from Object.prototype, not an own property of subject.
    expect(resolveAttribute('subject.toString', makeAttrs())).toBeUndefined();
  });

  it('resolves an array-valued attribute (e.g. roles) as-is', () => {
    expect(resolveAttribute('subject.roles', makeAttrs())).toEqual(['role_admin']);
  });
});
