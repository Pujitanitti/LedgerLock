import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { HealthModule } from './health/health.module';
import { validateEnv } from './common/config/env.validation';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { RbacModule } from './rbac/rbac.module';
import { PoliciesModule } from './policies/policies.module';
import { AuthorizationModule } from './authorization/authorization.module';

// Phase 2 scaffold + Phase 3 (tenant + API-key authentication) + Phase 4
// (RBAC + authorization core) + Phase 5 (ABAC policy engine + policy
// versioning). Redis decision caching and audit-log pipelines remain
// unimplemented and are NOT imported here — adding them ahead of their
// own phase would violate the "no placeholder modules" quality gate.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: ['.env'],
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    RbacModule,
    PoliciesModule,
    AuthorizationModule,
  ],
})
export class AppModule {}
