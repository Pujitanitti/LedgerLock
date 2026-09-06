import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuditDecisionEvent } from '../types/audit-event';
import type { AuditOutboxRecord, AuditOutboxRepositoryPort } from './audit-outbox-repository.port';

/**
 * VERIFICATION STATUS: same category as every other Prisma-touching file
 * in this project — environment-blocked here because `new PrismaClient()`
 * throws immediately in this sandbox's pre-generation state. Written as
 * correct production code.
 */
@Injectable()
export class PrismaAuditOutboxRepository implements AuditOutboxRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(payload: AuditDecisionEvent): Promise<string> {
    const row = await this.prisma.auditOutbox.create({
      data: { payload: payload as unknown as object },
    });
    return row.id;
  }

  async claimBatch(limit: number, now: Date): Promise<AuditOutboxRecord[]> {
    const rows: {
      id: string;
      payload: unknown;
      attempts: number;
      lastError: string | null;
      processedAt: Date | null;
      nextAttemptAt: Date;
      deadLetteredAt: Date | null;
      createdAt: Date;
    }[] = await this.prisma.auditOutbox.findMany({
      where: { processedAt: null, deadLetteredAt: null, nextAttemptAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      payload: row.payload as unknown as AuditDecisionEvent,
      attempts: row.attempts,
      lastError: row.lastError,
      processedAt: row.processedAt,
      nextAttemptAt: row.nextAttemptAt,
      deadLetteredAt: row.deadLetteredAt,
      createdAt: row.createdAt,
    }));
  }

  async markProcessed(outboxId: string): Promise<void> {
    // Scoped to `processedAt: null` so a duplicate/late call is a true
    // no-op (zero rows affected) rather than overwriting a real
    // processedAt timestamp with a later one.
    await this.prisma.auditOutbox.updateMany({
      where: { id: outboxId, processedAt: null },
      data: { processedAt: new Date() },
    });
  }

  async recordFailure(outboxId: string, error: string, nextAttemptAt: Date, deadLetter: boolean): Promise<void> {
    await this.prisma.auditOutbox.update({
      where: { id: outboxId },
      data: {
        attempts: { increment: 1 },
        lastError: error,
        nextAttemptAt,
        deadLetteredAt: deadLetter ? new Date() : null,
      },
    });
  }

  async writeAuditLog(outboxId: string, payload: AuditDecisionEvent): Promise<void> {
    await this.prisma.auditLog.upsert({
      where: { sourceOutboxId: outboxId },
      update: {}, // already exists from a prior attempt — leave the original write intact, idempotent no-op
      create: {
        sourceOutboxId: outboxId,
        tenantId: payload.tenantId,
        userId: payload.userId,
        action: payload.action,
        resourceType: payload.resourceType,
        resourceId: payload.resourceId,
        decision: payload.decision,
        reason: payload.reason,
        policyId: payload.policyId,
        policyVersion: payload.policyVersionNumber,
        matchedPolicies: payload.matchedPolicies as unknown as object | undefined,
        servedFromCache: payload.servedFromCache,
        latencyMs: payload.latencyMs,
        requestId: payload.requestId,
      },
    });
  }
}
