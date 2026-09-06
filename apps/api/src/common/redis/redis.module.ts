import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Redis is a performance optimization, never a source of truth. Every
 * consumer of REDIS_CLIENT (see authorization/decision-cache) MUST treat
 * connection errors, timeouts, and malformed data as a cache miss and fall
 * back to PostgreSQL — never as a reason to allow a request. See
 * docs/decisions/ADR-003 and ADR-005 (fail closed).
 *
 * `maxRetriesPerRequest: 1` and a short `commandTimeout` keep a downed
 * Redis from stalling the authorization hot path for the default
 * ioredis retry duration.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const url = config.get<string>('REDIS_URL', 'redis://localhost:6379');
        return new Redis(url, {
          maxRetriesPerRequest: 1,
          commandTimeout: 250,
          enableOfflineQueue: false,
          lazyConnect: false,
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
