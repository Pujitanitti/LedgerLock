import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthIndicatorResult } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { PrismaService } from '../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Process is up. Used for container liveness probes. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Process is up AND its critical dependencies are reachable. Used for
   * readiness probes / load-balancer registration. Distinguishes DB vs
   * Redis so an operator can tell which dependency is degraded — Redis
   * being down should show as degraded-but-serving (authorization still
   * works via Postgres fallback), never as fully unhealthy.
   */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      (): Promise<HealthIndicatorResult> => this.checkDatabase(),
      (): Promise<HealthIndicatorResult> => this.checkRedis(),
    ]);
  }

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { database: { status: 'up' } };
    } catch {
      return { database: { status: 'down' } };
    }
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    try {
      await this.redis.ping();
      return { redis: { status: 'up' } };
    } catch {
      // Redis being down is reported for visibility, but per the fail-closed
      // design it does NOT make the service unable to authorize requests —
      // see authorization/decision-cache for the fallback path.
      return { redis: { status: 'down' } };
    }
  }
}
