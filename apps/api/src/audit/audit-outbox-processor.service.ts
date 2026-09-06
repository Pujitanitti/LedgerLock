import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_OUTBOX_REPOSITORY,
  type AuditOutboxRecord,
  type AuditOutboxRepositoryPort,
} from './repositories/audit-outbox-repository.port';
import { computeBackoffSeconds, shouldDeadLetter } from './backoff';

export const DEFAULT_BATCH_SIZE = 50;

export interface ProcessBatchResult {
  claimed: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
}

/**
 * SCHEDULING, EXPLICITLY OUT OF SCOPE (flagged in ADR-012 and the risk
 * register as a provisional decision requiring review): this class only
 * implements the processing logic for one batch. Nothing in this
 * codebase calls `processBatch` on an interval — wiring that requires
 * picking a scheduling mechanism (a cron dependency, a queue, an
 * external trigger), which isn't something this phase adds without
 * explicit sign-off, per "no dependencies without necessity." The
 * correctness of the processing logic itself is fully unit-tested
 * without needing a real scheduler to exist.
 *
 * IDEMPOTENCY: `writeAuditLog` upserts by `sourceOutboxId` (see
 * PrismaAuditOutboxRepository), so calling `processBatch` again over a
 * row that was already fully processed — including the case where a
 * crash happened between "wrote AuditLog" and "marked outbox
 * processed" — never produces a duplicate AuditLog row. `markProcessed`
 * is separately idempotent (scoped to `processedAt: null`).
 *
 * KNOWN LIMITATION (M-3, final adversarial audit — deliberately NOT
 * fixed while R-008 is undecided): `claimBatch` (see
 * PrismaAuditOutboxRepository) is a plain read query — it does not lock
 * or mark rows as "claimed" the way `SELECT ... FOR UPDATE SKIP LOCKED`
 * or a claimed-by/claimed-at marker would. This is safe today because
 * nothing in this codebase invokes `processBatch` concurrently at all
 * (see the scheduling note above). If R-008 is ever resolved by wiring a
 * scheduler that could run more than one instance/worker, two concurrent
 * calls could both claim and process the same rows. The idempotent
 * upsert above still prevents any duplicate AuditLog row or corrupted
 * final state — the one real side effect is `recordFailure`'s
 * `attempts` counter, which could be double-incremented for a single
 * logical failure, causing premature dead-lettering. This has zero
 * authorization impact (audit processing is fully decoupled from the
 * request/response path) and must be addressed before this is ever run
 * with more than one concurrent instance — not before then.
 */
@Injectable()
export class AuditOutboxProcessorService {
  private readonly logger = new Logger(AuditOutboxProcessorService.name);

  constructor(
    @Inject(AUDIT_OUTBOX_REPOSITORY) private readonly repository: AuditOutboxRepositoryPort,
  ) {}

  async processBatch(limit: number = DEFAULT_BATCH_SIZE, now: Date = new Date()): Promise<ProcessBatchResult> {
    const claimed = await this.repository.claimBatch(limit, now);
    const result: ProcessBatchResult = { claimed: claimed.length, succeeded: 0, failed: 0, deadLettered: 0 };

    for (const row of claimed) {
      await this.processOne(row, result);
    }

    return result;
  }

  private async processOne(row: AuditOutboxRecord, result: ProcessBatchResult): Promise<void> {
    try {
      // Order matters for the crash-safety argument above: write the
      // durable AuditLog row FIRST, then mark the outbox row processed.
      // If the process crashes between these two lines, the next
      // processBatch call re-claims this row (nextAttemptAt/processedAt
      // are unchanged) and re-runs writeAuditLog, which is a safe no-op
      // thanks to the upsert-by-sourceOutboxId — then successfully marks
      // it processed. The reverse order (mark processed first) would
      // risk losing the audit record entirely on a crash in between.
      await this.repository.writeAuditLog(row.id, row.payload);
      await this.repository.markProcessed(row.id);
      result.succeeded += 1;
    } catch (err) {
      const attemptsAfterThisFailure = row.attempts + 1;
      const deadLetter = shouldDeadLetter(attemptsAfterThisFailure);
      const nextAttemptAt = new Date(Date.now() + computeBackoffSeconds(attemptsAfterThisFailure) * 1000);

      await this.repository.recordFailure(row.id, String(err), nextAttemptAt, deadLetter);

      if (deadLetter) {
        result.deadLettered += 1;
        this.logger.error(
          `Audit outbox row ${row.id} dead-lettered after ${attemptsAfterThisFailure} attempts: ${String(err)}`,
        );
      } else {
        result.failed += 1;
        this.logger.warn(
          `Audit outbox row ${row.id} failed (attempt ${attemptsAfterThisFailure}/pending retry): ${String(err)}`,
        );
      }
    }
  }
}
