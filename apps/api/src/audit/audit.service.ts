import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_OUTBOX_REPOSITORY,
  type AuditOutboxRepositoryPort,
} from './repositories/audit-outbox-repository.port';
import type { AuditDecisionEvent } from './types/audit-event';

/**
 * DURABILITY MODEL, STATED EXPLICITLY (see ADR-012): audit is
 * durable-but-asynchronous, NOT mandatory for the request to complete
 * and NOT best-effort-and-forgotten. "Durable" because a successful
 * `enqueue` is a real, indexed database row that survives a process
 * crash — it will eventually reach AuditLog via AuditOutboxProcessorService
 * even if this process dies immediately after. "Asynchronous" because
 * the authorization response is never delayed waiting for that to
 * happen. "Not mandatory" because if even the enqueue itself fails
 * (e.g. Postgres is down), the authorization decision — already
 * computed correctly — is still returned to the caller; a missing audit
 * trail for one decision is a lesser failure than making tenant access
 * depend on audit-infrastructure health, which would let an
 * infrastructure problem masquerade as an authorization outage.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(AUDIT_OUTBOX_REPOSITORY) private readonly repository: AuditOutboxRepositoryPort,
  ) {}

  async recordDecision(event: AuditDecisionEvent): Promise<void> {
    try {
      await this.repository.enqueue(event);
    } catch (err) {
      // Never rethrown — see the class doc comment. The caller (the
      // decision engine) has already returned/is about to return the
      // correct authorization decision regardless of this outcome.
      this.logger.error(
        `Failed to enqueue audit event for tenant ${event.tenantId}, request ${event.requestId}: ${String(err)}`,
      );
    }
  }
}
