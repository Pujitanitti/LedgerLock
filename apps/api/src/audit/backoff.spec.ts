import { computeBackoffSeconds, MAX_AUDIT_ATTEMPTS, shouldDeadLetter } from './backoff';

describe('computeBackoffSeconds', () => {
  it('doubles with each attempt', () => {
    expect(computeBackoffSeconds(1)).toBe(2);
    expect(computeBackoffSeconds(2)).toBe(4);
    expect(computeBackoffSeconds(3)).toBe(8);
    expect(computeBackoffSeconds(4)).toBe(16);
  });

  it('caps at the maximum backoff regardless of how large attempts gets', () => {
    expect(computeBackoffSeconds(20)).toBe(300);
    expect(computeBackoffSeconds(1000)).toBe(300);
  });

  it('is deterministic — same input always produces the same output', () => {
    expect(computeBackoffSeconds(3)).toBe(computeBackoffSeconds(3));
  });

  it('handles zero/negative attempts defensively without producing a negative or NaN delay', () => {
    expect(computeBackoffSeconds(0)).toBe(2);
    expect(computeBackoffSeconds(-1)).toBe(2);
  });
});

describe('shouldDeadLetter', () => {
  it('is false below the max attempt count', () => {
    expect(shouldDeadLetter(MAX_AUDIT_ATTEMPTS - 1)).toBe(false);
  });

  it('is true at exactly the max attempt count', () => {
    expect(shouldDeadLetter(MAX_AUDIT_ATTEMPTS)).toBe(true);
  });

  it('is true beyond the max attempt count', () => {
    expect(shouldDeadLetter(MAX_AUDIT_ATTEMPTS + 5)).toBe(true);
  });
});
