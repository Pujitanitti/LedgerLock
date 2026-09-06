import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TENANT_REPOSITORY } from './repositories/tenant-repository.port';
import { PrismaTenantRepository } from './repositories/prisma-tenant.repository';
import { RateLimitModule } from '../common/rate-limit/rate-limit.module';
import { TenantProvisioningRateLimitGuard } from './guards/tenant-provisioning-rate-limit.guard';

@Module({
  imports: [RateLimitModule],
  controllers: [TenantsController],
  providers: [
    TenantsService,
    TenantProvisioningService,
    TenantProvisioningRateLimitGuard,
    { provide: TENANT_REPOSITORY, useClass: PrismaTenantRepository },
  ],
  exports: [TenantsService, TENANT_REPOSITORY],
})
export class TenantsModule {}
