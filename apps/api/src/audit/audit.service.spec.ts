import { AuditService } from './audit.service';
import type { AuditOutboxRepositoryPort } from './repositories/audit-outbox-repository.port';
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

function makeRepo(overrides: Partial<jest.Mocked<AuditOutboxRepositoryPort>> = {}): jest.Mocked<AuditOutboxRepositoryPort> {
  return {
    enqueue: jest.fn().mockResolvedValue('outbox_1'),
    claimBatch: jest.fn(),
    markProcessed: jest.fn(),
    recordFailure: jest.fn(),
    writeAuditLog: jest.fn(),
    ...overrides,
  } as jest.Mocked<AuditOutboxRepositoryPort>;
}

describe('AuditService.recordDecision', () => {
  it('enqueues the event via the repository', async () => {
    const repo = makeRepo();
    const service = new AuditService(repo);

    await service.recordDecision(makeEvent());

    expect(repo.enqueue).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant_a' }));
  });

  it('SAFETY: never throws when the repository enqueue fails', async () => {
    const repo = makeRepo({ enqueue: jest.fn().mockRejectedValue(new Error('DB down')) });
    const service = new AuditService(repo);

    await expect(service.recordDecision(makeEvent())).resolves.toBeUndefined();
  });

  it('SAFETY: a failed enqueue does not affect anything else — the method simply resolves', async () => {
    const repo = makeRepo({ enqueue: jest.fn().mockRejectedValue(new Error('connection refused')) });
    const service = new AuditService(repo);

    await service.recordDecision(makeEvent({ tenantId: 'tenant_b' }));

    expect(repo.enqueue).toHaveBeenCalledTimes(1);
  });
});
