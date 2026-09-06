import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import type { RateLimiterPort, RateLimitResult } from './rate-limiter.port';

/**
 * FAIL-OPEN ON REDIS ERROR — deliberately the OPPOSITE failure direction
 * from RedisDecisionCache and every other authorization-critical path in
 * this project, and worth being explicit about why: this is an
 * abuse-prevention throttle, not an authorization decision. Failing
 * closed here would mean a Redis hiccup makes the (already-
 * unauthenticated, by-necessity) `POST /v1/tenants` endpoint unusable for
 * legitimate callers — a worse outcome than temporarily losing the rate
 * limit itself. No authorization bypass results either way: this guard
 * never grants access to anything that requires a permission check; it
 * only throttles requests to an endpoint that has no authorization check
 * in the first place (see ADR-008 / risk register R-001, which this only
 * partially mitigates — it does not close R-001).
 */
@Injectable()
export class RedisRateLimiter implements RateLimiterPort {
  private readonly logger = new Logger(RedisRateLimiter.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        // Only set the expiry on the FIRST increment in a window — an
        // EXPIRE on every call would keep pushing the window forward
        // indefinitely for a sustained attacker instead of it resetting.
        await this.redis.expire(key, windowSeconds);
      }
      const ttl = await this.redis.ttl(key);
      const resetSeconds = ttl > 0 ? ttl : windowSeconds;

      return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetSeconds };
    } catch (err) {
      this.logger.warn(`Redis rate-limit check failed; failing open (request allowed): ${String(err)}`);
      return { allowed: true, remaining: limit, resetSeconds: windowSeconds };
    }
  }
}
