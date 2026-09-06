import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RATE_LIMITER, type RateLimiterPort } from '../../common/rate-limit/rate-limiter.port';

/**
 * PARTIAL MITIGATION FOR R-001, NOT A FIX: `POST /v1/tenants` remains
 * genuinely unauthenticated — see ADR-008. This guard only throttles how
 * many tenant-provisioning attempts a single source IP can make in a
 * window; it does not add legitimacy checking, does not prevent a
 * distributed attacker from rotating IPs, and does not require any
 * credential. It is the "at minimum rate limiting + abuse monitoring"
 * step ADR-008 named as the most plausible near-term mitigation that
 * doesn't require inventing new identity infrastructure. R-001 remains
 * OPEN in the risk register even after this.
 *
 * Keyed by IP address (`req.ip`) rather than anything from the request
 * body, since the body is exactly what an attacker controls — a
 * different tenant name/slug per request must not reset the counter.
 */
const LIMIT = 5;
const WINDOW_SECONDS = 60 * 60; // 1 hour

@Injectable()
export class TenantProvisioningRateLimitGuard implements CanActivate {
  constructor(@Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiterPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const key = `ratelimit:tenant-provision:${request.ip ?? 'unknown'}`;
    const result = await this.rateLimiter.consume(key, LIMIT, WINDOW_SECONDS);

    response.setHeader('X-RateLimit-Limit', String(LIMIT));
    response.setHeader('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      response.setHeader('Retry-After', String(result.resetSeconds));
      throw new HttpException(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many tenant-creation attempts from this source. Try again later.',
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
