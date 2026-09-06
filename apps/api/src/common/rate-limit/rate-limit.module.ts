import { Module } from '@nestjs/common';
import { RATE_LIMITER } from './rate-limiter.port';
import { RedisRateLimiter } from './redis-rate-limiter';

@Module({
  providers: [{ provide: RATE_LIMITER, useClass: RedisRateLimiter }],
  exports: [RATE_LIMITER],
})
export class RateLimitModule {}
