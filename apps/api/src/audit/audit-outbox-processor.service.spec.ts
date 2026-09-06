import { AuditOutboxProcessorService } from './audit-outbox-processor.service';
import { MAX_AUDIT_ATTEMPTS } from './backoff';
import type { AuditOutboxRecord, AuditOutboxRepositoryPort } from './repositories/audit-outbox-repository.port';
import type { AuditDecisionEvent } from './types/audit-event';

function makeEvent(overrides: Partial<AuditDecisionEvent> = {}): AuditDecisionEvent {
  return {
    tenantId: 'tenant_a',
    userId: 'ext_alice',
    action: 'invoices:update',
    resourceType: 'invoice',
    resourceId: 'inv_1',
    decision: 'allow',
    reason: 'role_permission',
    policyId: null,
    policyVersionNumber: null,
    matchedPolicies: null,
    servedFromCache: false,
    latencyMs: 4.2,
    requestId: 'req_123',
    ...overrides,
  };
}

function makeRow(overrides: Partial<AuditOutboxRecord> = {}): AuditOutboxRecord {
  return {
    id: 'outbox_1',
    payload: makeEvent(),
    attempts: 0,
    lastError: null,
    processedAt: null,
    nextAttemptAt: new Date('2026-01-01T00:00:00.000Z'),
    deadLetteredAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<jest.Mocked<AuditOutboxRepositoryPort>> = {}): jest.Mocked<AuditOutboxRepositoryPort> {
  return {
    enqueue: jest.fn(),
    claimBatch: jest.fn().mockResolvedValue([]),
    markProcessed: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    writeAuditLog: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<AuditOutboxRepositoryPort>;
}

describe('AuditOutboxProcessorService.processBatch - success path', () => {
  it('writes the AuditLog row BEFORE marking the outbox row processed (crash-safety ordering)', async () => {
    const callOrder: string[] = [];
    const repo = makeRepo({
      claimBatch: jest.fn().mockResolvedValue([makeRow()]),
      writeAuditLog: jest.fn().mockImplementation(() => {
        callOrder.push('writeAuditLog');
        return Promise.resolve();
      }),
      markProcessed: jest.fn().mockImplementation(() => {
        callOrder.push('markProcessed');
        return Promise.resolve();
      }),
    });
    const processor = new AuditOutboxProcessorService(repo);

    await processor.processBatch();

    expect(callOrder).toEqual(['writeAuditLog', 'markProcessed']);
  });

  it('reports success counts accurately', async () => {
    const repo = makeRepo({ claimBatch: jest.fn().mockResolvedValue([makeRow(), makeRow({ id: 'outbox_2' })]) });
    const processor = new AuditOutboxProcessorService(repo);

    const result = await processor.processBatch();

    expect(result).toEqual({ claimed: 2, succeeded: 2, failed: 0, deadLettered: 0 });
  });

  it('returns zeroed counts when there is nothing to claim', async () => {
    const processor = new AuditOutboxProcessorService(makeRepo({ claimBatch: jest.fn().mockResolvedValue([]) }));

    const result = await processor.processBatch();

    expect(result).toEqual({ claimed: 0, succeeded: 0, failed: 0, deadLettered: 0 });
  });
});

describe('AuditOutboxProcessorService.processBatch - retry and backoff', () => {
  it('records a failure with an incremented attempt count and a future nextAttemptAt when writeAuditLog throws', async () => {
    const repo = makeRepo({
      claimBatch: jest.fn().mockResolvedValue([makeRow({ attempts: 1 })]),
      writeAuditLog: jest.fn().mockRejectedValue(new Error('DB connection lost')),
    });
    const processor = new AuditOutboxProcessorService(repo);

    const result = await processor.processBatch();

    expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 1, deadLettered: 0 });
    expect(repo.recordFailure).toHaveBeenCalledWith(
      'outbox_1',
      expect.stringContaining('DB connection lost'),
      expect.any(Date),
      false,
    );
    const call = repo.recordFailure.mock.calls[0];
    const nextAttemptAt = call[2] as Date;
    expect(nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('never calls markProcessed when writeAuditLog fails', async () => {
    const repo = makeRepo({
      claimBatch: jest.fn().mockResolvedValue([makeRow()]),
      writeAuditLog: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const processor = new AuditOutboxProcessorService(repo);

    await processor.processBatch();

    expect(repo.markProcessed).not.toHaveBeenCalled();
  });

  it('dead-letters a row once it reaches MAX_AUDIT_ATTEMPTS', async () => {
    const repo = makeRepo({
      claimBatch: jest.fn().mockResolvedValue([makeRow({ attempts: MAX_AUDIT_ATTEMPTS - 1 })]),
      writeAuditLog: jest.fn().mockRejectedValue(new Error('permanent failure')),
    });
    const processor = new AuditOutboxProcessorService(repo);

    const result = await processor.processBatch();

    expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 0, deadLettered: 1 });
    expect(repo.recordFailure).toHaveBeenCalledWith('outbox_1', expect.any(String), expect.any(Date), true);
  });

  it('does not dead-letter a row below the max attempt threshold', async () => {
    const repo = makeRepo({
      claimBatch: jest.fn().mockResolvedValue([makeRow({ attempts: 0 })]),
      writeAuditLog: jest.fn().mockRejectedValue(new Error('transient')),
    });
    const processor = new AuditOutboxProcessorService(repo);

    await processor.processBatch();

    expect(repo.recordFailure).toHaveBeenCalledWith('outbox_1', expect.any(String), expect.any(Date), false);
  });

  it('processes remaining rows in a batch even when one row fails', async () => {
    const repo = makeRepo({
      claimBatch: jest.fn().mockResolvedValue([
        makeRow({ id: 'outbox_fail' }),
        makeRow({ id: 'outbox_ok' }),
      ]),
      writeAuditLog: jest.fn().mockImplementation((id: string) => {
        if (id === 'outbox_fail') return Promise.reject(new Error('fails'));
        return Promise.resolve();
      }),
    });
    const processor = new AuditOutboxProcessorService(repo);

    const result = await processor.processBatch();

    expect(result).toEqual({ claimed: 2, succeeded: 1, failed: 1, deadLettered: 0 });
  });
});

describe('AuditOutboxProcessorService - claimBatch contract', () => {
  it('re-processing is safe because writeAuditLog upserts by sourceOutboxId and markProcessed/claimBatch are idempotent at the repository level (documented, not re-tested here — see PrismaAuditOutboxRepository)', async () => {
    const repo = makeRepo({ claimBatch: jest.fn().mockResolvedValue([]) });
    const processor = new AuditOutboxProcessorService(repo);

    await processor.processBatch();

    expect(repo.claimBatch).toHaveBeenCalledWith(expect.any(Number), expect.any(Date));
  });

  it('passes a custom limit and now through to claimBatch', async () => {
    const repo = makeRepo();
    const processor = new AuditOutboxProcessorService(repo);
    const fixedNow = new Date('2026-06-01T00:00:00.000Z');

    await processor.processBatch(10, fixedNow);

    expect(repo.claimBatch).toHaveBeenCalledWith(10, fixedNow);
  });
});
