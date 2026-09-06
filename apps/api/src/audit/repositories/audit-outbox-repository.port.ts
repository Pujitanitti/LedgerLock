import type { AuditDecisionEvent } from '../types/audit-event';

export const AUDIT_OUTBOX_REPOSITORY = Symbol('AUDIT_OUTBOX_REPOSITORY');

export interface AuditOutboxRecord {
  id: string;
  payload: AuditDecisionEvent;
  attempts: number;
  lastError: string | null;
  processedAt: Date | null;
  nextAttemptAt: Date;
  deadLetteredAt: Date | null;
  createdAt: Date;
}

export interface AuditOutboxRepositoryPort {
  /** Single indexed insert — this is the ONLY thing the request/response cycle waits on for audit. */
  enqueue(payload: AuditDecisionEvent): Promise<string>;

  /**
   * Rows not yet processed, not dead-lettered, and whose `nextAttemptAt`
   * has passed — ordered oldest-first so a backlog drains in submission
   * order rather than arbitrarily.
   */
  claimBatch(limit: number, now: Date): Promise<AuditOutboxRecord[]>;

  /** Idempotent — marking an already-processed row processed again is a no-op, never an error. */
  markProcessed(outboxId: string): Promise<void>;

  recordFailure(outboxId: string, error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void>;

  /**
   * Upserts into AuditLog keyed by `sourceOutboxId` — this is what makes
   * re-processing the same outbox row (after a crash between "wrote
   * AuditLog" and "marked outbox processed") safe: the second attempt
   * updates the same row instead of inserting a duplicate.
   */
  writeAuditLog(outboxId: string, payload: AuditDecisionEvent): Promise<void>;
}
