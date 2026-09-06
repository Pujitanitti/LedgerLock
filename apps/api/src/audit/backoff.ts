export const MAX_AUDIT_ATTEMPTS = 5;
const BASE_BACKOFF_SECONDS = 2;
const MAX_BACKOFF_SECONDS = 300; // 5 minutes

/**
 * Exponential backoff, capped, deterministic (no jitter — jitter matters
 * for thundering-herd avoidance across many independent clients hitting
 * one shared resource; a single tenant's own audit outbox processor
 * retrying its own failed rows has no such herd to avoid, so the
 * simpler deterministic form is preferred here per "no speculative
 * complexity").
 *
 * attempts=1 -> 2s, attempts=2 -> 4s, attempts=3 -> 8s, attempts=4 -> 16s,
 * attempts=5 -> 32s, ... capped at 300s.
 */
export function computeBackoffSeconds(attempts: number): number {
  const raw = BASE_BACKOFF_SECONDS * 2 ** Math.max(0, attempts - 1);
  return Math.min(raw, MAX_BACKOFF_SECONDS);
}

/** Whether a row that has just failed for the Nth time should be dead-lettered rather than retried again. */
export function shouldDeadLetter(attemptsAfterThisFailure: number): boolean {
  return attemptsAfterThisFailure >= MAX_AUDIT_ATTEMPTS;
}
