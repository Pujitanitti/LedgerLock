import { evaluateApiKeyStatus } from './api-key-status.policy';

describe('evaluateApiKeyStatus', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');

  it('is active when both revokedAt and expiresAt are null', () => {
    expect(evaluateApiKeyStatus({ revokedAt: null, expiresAt: null }, now)).toBe('active');
  });

  it('is active when expiresAt is in the future', () => {
    const future = new Date('2027-01-01T00:00:00.000Z');
    expect(evaluateApiKeyStatus({ revokedAt: null, expiresAt: future }, now)).toBe('active');
  });

  it('is expired when expiresAt is in the past', () => {
    const past = new Date('2025-01-01T00:00:00.000Z');
    expect(evaluateApiKeyStatus({ revokedAt: null, expiresAt: past }, now)).toBe('expired');
  });

  it('is expired at the exact boundary instant (expiresAt === now)', () => {
    expect(evaluateApiKeyStatus({ revokedAt: null, expiresAt: now }, now)).toBe('expired');
  });

  it('is revoked when revokedAt is set, regardless of expiresAt', () => {
    const revokedAt = new Date('2026-05-01T00:00:00.000Z');
    const future = new Date('2027-01-01T00:00:00.000Z');
    expect(evaluateApiKeyStatus({ revokedAt, expiresAt: future }, now)).toBe('revoked');
  });

  it('reports revoked (not expired) when a key is both revoked and past expiry', () => {
    const revokedAt = new Date('2025-06-01T00:00:00.000Z');
    const expiresAt = new Date('2025-01-01T00:00:00.000Z');
    expect(evaluateApiKeyStatus({ revokedAt, expiresAt }, now)).toBe('revoked');
  });

  it('defaults `now` to the current time when not provided', () => {
    const past = new Date(Date.now() - 1000);
    expect(evaluateApiKeyStatus({ revokedAt: null, expiresAt: past })).toBe('expired');
  });
});
