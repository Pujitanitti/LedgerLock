import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzVersionModule } from '../authorization/authz-version/authz-version.module';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { POLICY_REPOSITORY } from './repositories/policy-repository.port';
import { PrismaPolicyRepository } from './repositories/prisma-policy.repository';

@Module({
  imports: [AuthModule, AuthzVersionModule],
  controllers: [PoliciesController],
  providers: [PoliciesService, { provide: POLICY_REPOSITORY, useClass: PrismaPolicyRepository }],
  exports: [PoliciesService, POLICY_REPOSITORY],
})
export class PoliciesModule {}
