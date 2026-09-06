import {
  actionMatches,
  actionsMatchAny,
  resourceTypeMatches,
  resourceTypesMatchAny,
} from './policy-matching';

describe('actionMatches', () => {
  it('matches an exact action string', () => expect(actionMatches('invoices:delete', 'invoices:delete')).toBe(true));
  it('does not match a different action', () => expect(actionMatches('invoices:delete', 'invoices:read')).toBe(false));
  it('wildcard matches any action', () => expect(actionMatches('*', 'anything:here')).toBe(true));
});

describe('actionsMatchAny', () => {
  it('matches when any pattern in the list matches', () => {
    expect(actionsMatchAny(['projects:read', 'invoices:delete'], 'invoices:delete')).toBe(true);
  });
  it('does not match when no pattern matches', () => {
    expect(actionsMatchAny(['projects:read', 'projects:update'], 'invoices:delete')).toBe(false);
  });
  it('is false for an empty pattern list', () => {
    expect(actionsMatchAny([], 'invoices:delete')).toBe(false);
  });
});

describe('resourceTypeMatches', () => {
  it('matches an exact resource type', () => expect(resourceTypeMatches('invoice', 'invoice')).toBe(true));
  it('does not match a different resource type', () => expect(resourceTypeMatches('invoice', 'project')).toBe(false));
  it('wildcard matches any resource type', () => expect(resourceTypeMatches('*', 'invoice')).toBe(true));
  it('wildcard matches even when no resource type was requested', () => {
    expect(resourceTypeMatches('*', undefined)).toBe(true);
  });
  it('a specific pattern does NOT match when no resource was requested at all', () => {
    expect(resourceTypeMatches('invoice', undefined)).toBe(false);
  });
});

describe('resourceTypesMatchAny', () => {
  it('matches when any pattern matches', () => {
    expect(resourceTypesMatchAny(['project', 'invoice'], 'invoice')).toBe(true);
  });
  it('does not match when no resource was requested and there is no wildcard', () => {
    expect(resourceTypesMatchAny(['project', 'invoice'], undefined)).toBe(false);
  });
  it('matches a resourceless check when the wildcard is present', () => {
    expect(resourceTypesMatchAny(['*'], undefined)).toBe(true);
  });
});
