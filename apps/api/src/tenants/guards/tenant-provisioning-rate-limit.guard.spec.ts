import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { TenantProvisioningRateLimitGuard } from './tenant-provisioning-rate-limit.guard';
import type { RateLimiterPort } from '../../common/rate-limit/rate-limiter.port';

function makeContext(ip = '1.2.3.4') {
  const headers: Record<string, string> = {};
  const request = { ip };
  const response = { setHeader: jest.fn((name: string, value: string) => (headers[name] = value)) };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, response, headers };
}

function makeRateLimiter(overrides: Partial<jest.Mocked<RateLimiterPort>> = {}): jest.Mocked<RateLimiterPort> {
  return {
    consume: jest.fn().mockResolvedValue({ allowed: true, remaining: 4, resetSeconds: 3600 }),
    ...overrides,
  } as jest.Mocked<RateLimiterPort>;
}

describe('TenantProvisioningRateLimitGuard', () => {
  it('allows the request when under the limit', async () => {
    const rateLimiter = makeRateLimiter();
    const guard = new TenantProvisioningRateLimitGuard(rateLimiter);
    const { context } = makeContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('keys the rate-limit check by IP address, not by anything in the request body', async () => {
    const rateLimiter = makeRateLimiter();
    const guard = new TenantProvisioningRateLimitGuard(rateLimiter);
    const { context } = makeContext('9.9.9.9');

    await guard.canActivate(context);

    expect(rateLimiter.consume).toHaveBeenCalledWith(
      'ratelimit:tenant-provision:9.9.9.9',
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('throws a 429 HttpException when the limit is exceeded', async () => {
    const rateLimiter = makeRateLimiter({
      consume: jest.fn().mockResolvedValue({ allowed: false, remaining: 0, resetSeconds: 1800 }),
    });
    const guard = new TenantProvisioningRateLimitGuard(rateLimiter);
    const { context } = makeContext();

    const error = await guard.canActivate(context).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
  });

  it('sets a Retry-After header when rejecting', async () => {
    const rateLimiter = makeRateLimiter({
      consume: jest.fn().mockResolvedValue({ allowed: false, remaining: 0, resetSeconds: 1800 }),
    });
    const guard = new TenantProvisioningRateLimitGuard(rateLimiter);
    const { context, headers } = makeContext();

    await guard.canActivate(context).catch(() => undefined);

    expect(headers['Retry-After']).toBe('1800');
  });

  it('sets X-RateLimit-Limit and X-RateLimit-Remaining headers on every request', async () => {
    const rateLimiter = makeRateLimiter({
      consume: jest.fn().mockResolvedValue({ allowed: true, remaining: 2, resetSeconds: 3600 }),
    });
    const guard = new TenantProvisioningRateLimitGuard(rateLimiter);
    const { context, headers } = makeContext();

    await guard.canActivate(context);

    expect(headers['X-RateLimit-Remaining']).toBe('2');
    expect(headers['X-RateLimit-Limit']).toBeDefined();
  });

  it('does not throw when the rate limiter itself fails open (allowed: true from a Redis error)', async () => {
    const rateLimiter = makeRateLimiter({
      consume: jest.fn().mockResolvedValue({ allowed: true, remaining: 5, resetSeconds: 3600 }),
    });
    const guard = new TenantProvisioningRateLimitGuard(rateLimiter);
    const { context } = makeContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
