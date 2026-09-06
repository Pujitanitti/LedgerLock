import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { isCachedDecision } from './cached-decision-validator';
import type { CachedDecision, DecisionCachePort } from './decision-cache.port';

/**
 * Every failure path here returns/resolves rather than throwing or
 * propagating — a Redis outage must degrade the authorization pipeline
 * to "always fall through to the authoritative evaluator," never crash
 * the request or (worse) be interpreted anywhere upstream as an allow.
 * DecisionEngineService never sees a Redis error; it only ever sees
 * `null` (miss) or a validated CachedDecision (hit).
 */
@Injectable()
export class RedisDecisionCache implements DecisionCachePort {
  private readonly logger = new Logger(RedisDecisionCache.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get(key: string): Promise<CachedDecision | null> {
    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (err) {
      this.logger.warn(
        `Redis GET failed for decision cache key; falling back to authoritative evaluation: ${String(err)}`,
      );
      return null;
    }

    if (raw === null) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn('Malformed (non-JSON) decision cache entry encountered; treating as a miss.');
      return null;
    }

    if (!isCachedDecision(parsed)) {
      this.logger.warn('Decision cache entry did not match the expected shape; treating as a miss.');
      return null;
    }

    return parsed;
  }

  async set(key: string, decision: CachedDecision, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(decision), 'EX', ttlSeconds);
    } catch (err) {
      // The decision itself was already computed correctly and already
      // returned to the caller by the time this runs — a failed cache
      // write means the NEXT request for this key will also compute it
      // authoritatively, nothing more. Never rethrown.
      this.logger.warn(
        `Redis SET failed for decision cache key (decision was still served correctly): ${String(err)}`,
      );
    }
  }
}
