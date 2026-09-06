import type { ConfigService } from '@nestjs/config';
import type { TenantRepositoryPort } from '../../../tenants/repositories/tenant-repository.port';
import type { DecisionCachePort } from '../../decision-cache/decision-cache.port';
import type { AuditService } from '../../../audit/audit.service';

/** Default: tenant version 1, so cache keys are stable across a test unless explicitly overridden. */
export function makeMockTenantRepo(
  overrides: Partial<jest.Mocked<TenantRepositoryPort>> = {},
): jest.Mocked<TenantRepositoryPort> {
  return {
    create: jest.fn(),
    findBySlug: jest.fn(),
    findById: jest.fn(),
    getAuthzVersion: jest.fn().mockResolvedValue(1),
    incrementAuthzVersion: jest.fn(),
    ...overrides,
  } as jest.Mocked<TenantRepositoryPort>;
}

/** Default: always a cache miss, so tests exercise the authoritative path unless explicitly overridden. */
export function makeMockDecisionCache(
  overrides: Partial<jest.Mocked<DecisionCachePort>> = {},
): jest.Mocked<DecisionCachePort> {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<DecisionCachePort>;
}

export function makeMockAuditService(): jest.Mocked<Pick<AuditService, 'recordDecision'>> {
  return { recordDecision: jest.fn().mockResolvedValue(undefined) };
}

export function makeMockConfigService(ttlSeconds = 60): jest.Mocked<Pick<ConfigService, 'get'>> {
  return { get: jest.fn().mockReturnValue(ttlSeconds) };
}
